/**
 * ui/demoV2Samples.ts — the two exercises the v2 renderer is being reviewed on.
 *
 * PROTOTYPE DATA, deliberately kept out of `data/exercisePoses.ts`. The shipped
 * pose table is good and is under test; these two configs re-author the same two
 * movements for the VOLUMETRIC renderer, which needs three things the stick
 * renderer never asked for:
 *
 *   1. a FACING, because a filled torso has a chest and a back and the rig
 *      cannot infer which way the figure looks;
 *   2. a LAYER ORDER, because with volume "the far arm is dimmer" stops being
 *      enough — it has to be behind the torso, while the near leg has to be in
 *      front of it;
 *   3. FEET THAT LAND, because a stick foot is a 6-unit stroke and a shoe is a
 *      solid with thickness: every keyframe here was re-solved with two-link
 *      inverse kinematics so the ankle sits at one fixed point on the floor
 *      across the whole rep — the ONLY way a standing lift can look planted.
 *
 * A third keyframe was added to each (the shipped tables have two): with a
 * two-phase tempo the middle of the rep is where the eye actually is, and a
 * mid-frame is what bows the press's path outward and lets the RDL's hips lead
 * the chest instead of the two rotating in lockstep.
 *
 * Both are HAND-SOLVED, same as the shipped table: hip/ankle first, then the
 * knee from the law of cosines, then the arms hung so the dumbbells land where
 * the coaching copy says they should (`data/program.ts`: a1 "upper chest, deep
 * stretch"; c2 "the dumbbells graze the shins, hips travel back").
 */

import type { Pose } from './coachFigure.ts';
import { PAL, floor2, inclineBench2, shadow2, type DemoV2 } from './coachFigure2.ts';

/* ------------------------------------------------ a1 · incline dumbbell press */

/** Pelvis on the bench, spine along the 30° pad. Head to the right, feet left. */
const A1_PELVIS = { x: 69, y: 79.5 } as const;

/** Both legs are frozen for the whole set: this lift happens above the waist. */
const A1_LEGS = {
  leg: [168, 83, 176],
  legF: [171, 85, 176],
} as const satisfies Pick<Pose, 'leg' | 'legF'>;

const A1_BASE = { ...A1_PELVIS, torso: -30, head: -30, ...A1_LEGS } as const;

export const A1_V2: DemoV2 = {
  id: 'a1',
  he: 'לחיצת חזה בשיפוע חיובי',
  en: 'Incline Dumbbell Press',
  view: 'side',
  facing: -1,
  loopMs: 3000,
  // frames run bottom → top, so the FORWARD pass is the press: give it less
  // than half the clock and the lowering gets the rest.
  forwardShare: 0.42,
  frames: [
    // bottom: elbows below the shoulder line, dumbbells at the upper chest
    { ...A1_BASE, arm: [-208.1, -82.1], armF: [-204.7, -70.9] },
    // mid: the elbow travels wide, which is what bows the bar path outward
    { ...A1_BASE, arm: [-172, -94], armF: [-170, -84] },
    // top: the whole arm perpendicular to the pad, a hair short of lockout
    { ...A1_BASE, arm: [-138.5, -103.7], armF: [-140.9, -92.6] },
  ],
  // far arm behind the torso, near leg and near arm in front of it
  order: ['farArm', 'farLeg', 'body', 'nearLeg', 'nearArm'],
  props: () =>
    floor2(26, 148) +
    inclineBench2({ x: 66, y: 85, len: 46, angle: -30, seat: 11 }),
  hold: { k: 'db' },
  primary: 'chest',
  secondary: 'arms',
  muscles: ['חזה עליון', 'כתף קדמית · תלת ראשי'],
  // a lying lift is wide and low: crop tight around bench + body
  frame: [26, 32, 100, 75],
};

/* ------------------------------------------- c2 · romanian deadlift (dumbbell) */

/**
 * The planted foot: every frame's leg was solved back from the ankle at
 * `(80, 98.4)` — the one point the whole lift pivots around. The far leg takes
 * the same solution ±1.5°, which at a 17-unit thigh moves its ankle by less
 * than half a unit: a stance, not a limp.
 */
const C2_TOE = 4;

function c2Leg(thigh: number, shin: number): Pick<Pose, 'leg' | 'legF'> {
  return { leg: [thigh, shin, C2_TOE], legF: [thigh + 1.5, shin - 1.5, C2_TOE] };
}

export const C2_V2: DemoV2 = {
  id: 'c2',
  he: 'דדליפט רומני (RDL)',
  en: 'Romanian Deadlift',
  view: 'side',
  facing: 1,
  loopMs: 3400,
  // frames run standing → hinged, so the FORWARD pass is the ECCENTRIC: it gets
  // the long half of the clock and the drive back up is the quick one.
  forwardShare: 0.6,
  frames: [
    // tall, soft knee, dumbbells against the thighs
    { x: 80, y: 65.8, torso: -90, head: -90, arm: [86, 86], armF: [88, 88], ...c2Leg(81.3, 99.3) },
    // hips already travelling back while the chest is only half way down
    { x: 72, y: 67.5, torso: -55, head: -58, arm: [90, 90], armF: [92, 92], ...c2Leg(61.1, 90.8) },
    // bottom: hips 18 behind the ankle, back flat, dumbbells grazing the shins
    { x: 62, y: 71.5, torso: -20, head: -28, arm: [90, 90], armF: [92, 92], ...c2Leg(45.6, 67.5) },
  ],
  // standing, the near arm hangs OVER the torso and the far arm behind it
  order: ['farLeg', 'farArm', 'body', 'nearLeg', 'nearArm'],
  props: () => floor2(30, 140) + shadow2(80, 17),
  hold: { k: 'db' },
  primary: 'legs',
  secondary: 'back',
  muscles: ['ירך אחורית · ישבן', 'זוקפי גב'],
  // a standing lift is TALL: this stage is nearly square, which is the whole
  // reason the camera is per-demo — a 4:3 crop would spend half its pixels on
  // empty air either side of a vertical body
  frame: [37.5, 19, 80, 85],
  // the hanging arm sits ON the load path for most of this rep: move the guide
  // a hand's width in front of the body so it can be seen at all
  arcShift: [10, 0],
};

export const V2_SAMPLES: readonly DemoV2[] = [A1_V2, C2_V2];

/** The review page's own background, so the stage and the card agree. */
export const PREVIEW_BG = PAL.stage2;
