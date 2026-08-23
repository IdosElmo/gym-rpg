/**
 * data/exercisePoses.ts — one looping demonstration per built-in exercise.
 *
 * A demo is DATA, not media: a view (which plane the camera is on), two to
 * three keyframes of joint angles for the rig in `ui/coachFigure.ts`, the props
 * the lift happens on, what the hands are holding, a rep tempo, and the handful
 * of numbers the VOLUMETRIC renderer needs on top of a skeleton. Roughly 10 kB
 * of numbers for all 28 exercises — the whole feature ships without a single
 * byte of image, video or font, which is what keeps the single-file build
 * honest.
 *
 * THE KEYFRAMES ARE A YOYO. `frames` lists the rep in ONE direction (usually
 * start → finish) and `ui/exerciseDemo.ts` plays it there and back, but NOT
 * symmetrically: `forwardShare` says how much of the clock the forward pass
 * gets, because a rep is not symmetric — the eccentric is the slow half. A press
 * whose frames run bottom → top asks for less than half; a hinge whose frames
 * run standing → bottom asks for more.
 *
 * THE ANGLES WERE AUTHORED GEOMETRICALLY — each keyframe was solved so that the
 * hands land on the bar/handle/dumbbell position the movement actually calls
 * for, and consecutive keyframes are kept inside one continuous angular range
 * so a straight lerp rotates a joint the short, correct way (this is why some
 * angles read as -210 rather than 150: the value is what makes the NEXT frame a
 * 90° turn instead of a 270° one). Where a lift is done standing, the legs were
 * re-solved with two-link inverse kinematics so the ANKLE sits at one fixed
 * point across the whole rep: a stick foot was a stroke that could hover a unit
 * off the floor unnoticed, and a drawn shoe cannot. What guards all of it is
 * `tests/exercisePoses.test.ts`, which re-derives the joint positions from the
 * shipped numbers and asserts the movement.
 *
 * THE FIVE NUMBERS A VOLUMETRIC FIGURE NEEDS AND A STICK ONE DID NOT:
 *
 *   facing     a filled torso has a chest and a back, and the rig cannot infer
 *              which way it looks (two lifts can hold the pelvis at the same
 *              angle and face opposite ways).
 *   order      "the far arm is dimmer" stops being enough once limbs have
 *              volume: the far arm has to be BEHIND the torso while the near leg
 *              is in front of it, and which is which is per-exercise.
 *   camera     a stick figure survives being small; a face, a grip and a muscle
 *              patch all want pixels. A lying press and a standing hinge do not
 *              occupy remotely the same rectangle, so each demo frames itself.
 *   muscles    which region is under load, primary and secondary — and the
 *              Hebrew the legend chip says out loud.
 *   arc        where the load-path guide is sampled from, and how far it is
 *              nudged clear of the limb that carries it.
 *
 * The muscle regions are not free-form: `primary` is the exercise's own
 * `bodyPart` and `secondary` the heavier half of its `split` (`data/program.ts`),
 * and the pose test fails if a demo ever claims otherwise. The picture and the
 * XP the set pays are then two views of one fact.
 *
 * WE ANIMATE OUR OWN COACHING COPY. Where `data/program.ts` teaches a specific
 * variant, the demo follows THAT — b1 is the Smith rail (a fixed vertical bar
 * path) while a1 and c1 are the incline with dumbbells and the deeper stretch
 * c1's steps promise; the face pull is pulled to face height with high elbows
 * because that is what our steps say; b2 is drawn as the pull-up its steps
 * describe.
 *
 * A custom exercise (`cx_…`) has no entry here on purpose — see `demoFor`.
 */

import type { Hold, Pose, View } from '../ui/coachFigure.ts';
import type { ArcFrom, Layer, MuscleRegion } from '../ui/coachVolume.ts';
import {
  dipBars,
  flatBench,
  floor,
  inclineBench,
  legCurlStation,
  legExtensionStation,
  mat,
  pullBar,
  pulldownSeat,
  pulley,
  rail,
  shadow,
  uprightBench,
} from '../ui/coachProps.ts';

export interface ExerciseDemo {
  /** The exercise id this demonstrates (`data/program.ts`). */
  readonly id: string;
  readonly view: View;
  /** Which way the chest points: `front = spine + 90 × facing`. */
  readonly facing: 1 | -1;
  /** One full rep, there and back, in milliseconds. */
  readonly loopMs: number;
  /** How much of the loop the FORWARD pass of `frames` gets, 0.15–0.85. */
  readonly forwardShare: number;
  /** The rep in one direction; played as a yoyo. At least two. */
  readonly frames: readonly Pose[];
  /** The station: bench, rail, pulley, mat, floor. Static for the whole loop. */
  readonly props: () => string;
  /** What the hands are on. Positioned from the pose, never authored twice. */
  readonly hold: Hold;
  /** Back to front — every layer exactly once. */
  readonly order: readonly Layer[];
  /** The muscle the highlight paints; must be the exercise's own `bodyPart`. */
  readonly primary: MuscleRegion;
  /** The second-heaviest part of the exercise's `split`, when it has one. */
  readonly secondary?: MuscleRegion;
  /**
   * Which face of the working limb the muscle belly sits on. The same bone
   * carries two muscles — a curl is the front of the upper arm and a pushdown
   * its back, a hinge is the back of the thigh and a squat its front — so the
   * demo says which it means. Defaults: arms front, legs back.
   */
  readonly face?: 'front' | 'back';
  /** Hebrew muscle names for the legend chip, primary first. */
  readonly muscles: readonly string[];
  /** `[x, y, w, h]` of the 160×120 stage this demo is cropped to. */
  readonly camera: readonly [number, number, number, number];
  /** Which point the load-path guide follows; defaults to the load itself. */
  readonly arcFrom?: ArcFrom;
  /** `[dx, dy]` clearance for that guide, where a limb would hide it. */
  readonly arcShift?: readonly [number, number];
}

/* ------------------------------------------------------------ shared props */

const FLOOR = 102;

/** Back to front for a lift done on the feet: legs, far arm, body, near arm. */
const STANDING: readonly Layer[] = ['farLeg', 'farArm', 'body', 'nearLeg', 'nearArm'];
/** Lying down or hinged over: the far ARM goes behind everything. */
const SUPINE: readonly Layer[] = ['farArm', 'farLeg', 'body', 'nearLeg', 'nearArm'];
/**
 * The near arm BEHIND the torso: for the two lifts that finish with a hand at
 * the face, an arm drawn in front of the head hides the very thing the rep is
 * aiming at.
 */
const ARMS_BEHIND: readonly Layer[] = ['farLeg', 'farArm', 'nearArm', 'body', 'nearLeg'];
/**
 * Seen from the front, no limb is "far" — but the arms still work in front of
 * the chest and the legs still come out from under the hips, so both legs go
 * down first and both arms last.
 */
const FRONTAL: readonly Layer[] = ['farLeg', 'nearLeg', 'body', 'farArm', 'nearArm'];

/* ------------------------------------------------------------------ day A */

/**
 * a1 · INCLINE PRESS. Pelvis on the bench, spine along the 30° pad; both legs
 * are frozen for the whole set, because this lift happens above the waist.
 *
 * This is the configuration the volumetric renderer was reviewed and signed off
 * on, carried across unchanged: the same three keyframes (the middle one is what
 * bows the bar path outward), the same bench, the same camera, the same
 * chest-over-triceps highlight. a1's own copy and equipment list offer the bar
 * OR the dumbbells; the bar version is what b1 shows, so a1 shows the other one
 * and c1 takes it deeper still, exactly as c1's steps promise.
 */
const A1_BASE = { x: 69, y: 79.5, torso: -30, head: -30, leg: [168, 83, 176], legF: [171, 85, 176] } as const;

const A1: ExerciseDemo = {
  id: 'a1',
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
  props: () => floor(26, 148) + inclineBench({ x: 66, y: 85, len: 46, angle: -30, seat: 11 }),
  hold: { k: 'db' },
  // far arm behind the torso, near leg and near arm in front of it
  order: ['farArm', 'farLeg', 'body', 'nearLeg', 'nearArm'],
  primary: 'chest',
  secondary: 'arms',
  muscles: ['חזה עליון', 'כתף קדמית · תלת ראשי'],
  // a lying lift is wide and low: crop tight around bench + body
  camera: [26, 32, 100, 75],
};

const A2: ExerciseDemo = {
  id: 'a2',
  view: 'side',
  facing: -1,
  loopMs: 2800,
  forwardShare: 0.44,
  // One-arm row: the FAR side is the support (knee and hand on the bench) and
  // never moves; only the near arm rows the dumbbell to the hip pocket. The
  // standing foot was moved back until it lands BEHIND the bench's near post —
  // with a solid shoe and a solid post, "roughly the same place" is a collision.
  frames: [
    { x: 100, y: 68, torso: 182, head: 182, arm: [83.5, 95.7], armF: [82.8, 167.2], leg: [62.2, 86.2, 15], legF: [107.6, 0, 55] },
    { x: 100, y: 68, torso: 182, head: 182, arm: [-32.2, 64.9], armF: [82.8, 167.2], leg: [62.2, 86.2, 15], legF: [107.6, 0, 55] },
  ],
  props: () => floor(30, 146) + flatBench({ x: 52, y: 85, len: 52 }),
  hold: { k: 'dbNear' },
  order: STANDING,
  primary: 'back',
  secondary: 'arms',
  muscles: ['גב רחב · עובי גב', 'זרוע קדמית'],
  camera: [50, 46, 74, 62],
};

const A3: ExerciseDemo = {
  id: 'a3',
  view: 'side',
  facing: 1,
  loopMs: 3000,
  forwardShare: 0.58,
  // Split squat: BOTH feet are planted for the whole rep — the near ankle at
  // (84, 99) and the back one at (57, 98) — and the pelvis simply drops 12
  // between them. The middle frame is solved back from those two fixed ankles,
  // which is what stops the shoes sliding on the way down.
  frames: [
    { x: 72, y: 71, torso: -87, head: -87, arm: [90, 90], armF: [92, 90], leg: [44.9, 90.1, 25], legF: [89.7, 141.3, 45] },
    { x: 69, y: 77, torso: -87, head: -87, arm: [90, 90], armF: [92, 90], leg: [20.8, 93.2, 25], legF: [70.1, 161.7, 45] },
    { x: 66, y: 83, torso: -87, head: -87, arm: [90, 90], armF: [92, 90], leg: [0.1, 86.4, 25], legF: [55.7, 176.6, 45] },
  ],
  props: () => floor(36, 124) + shadow(72, 20),
  hold: { k: 'db' },
  order: STANDING,
  primary: 'legs',
  // a lunge is felt in the QUAD, not the hamstring: the belly goes on the front
  // of the thigh, and the glute stays where it always is
  face: 'front',
  muscles: ['ארבע ראשי · ישבן'],
  camera: [42, 28, 62, 78],
  // the dumbbells hang beside the thighs; push the guide clear of the near one
  arcShift: [9, 0],
};

const A4: ExerciseDemo = {
  id: 'a4',
  view: 'side',
  facing: -1,
  loopMs: 3000,
  forwardShare: 0.45,
  // Flye: the arms open into a wide V, each hand dropping past its own side of
  // the bench, then close over the chest — the honest way to draw a transverse
  // arc from the side, with the soft elbow held bent the whole way.
  frames: [
    { x: 72, y: 78, torso: 0, head: 0, arm: [98.5, 25.4], armF: [84, 162.8], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
    { x: 72, y: 78, torso: 0, head: 0, arm: [237.7, -70.3], armF: [-61.9, 220.6], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
  ],
  // the bench STARTS past the knees: a pad drawn under the shins reads as a
  // shin cutting through it, which a stroke figure got away with and a solid
  // one does not
  props: () => floor(28, 146) + flatBench({ x: 62, y: 84, len: 58 }),
  hold: { k: 'db' },
  order: SUPINE,
  primary: 'chest',
  muscles: ['חזה'],
  camera: [34, 34, 96, 74],
};

const A5: ExerciseDemo = {
  id: 'a5',
  view: 'side',
  facing: 1,
  loopMs: 2400,
  forwardShare: 0.42,
  // Curl: the upper arm is IDENTICAL in both frames (elbow pinned to the ribs)
  // and only the forearm rotates. Zero body sway — the pelvis never moves.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, 90], armF: [88, 90], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, -60], armF: [88, -64], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => floor(46, 116) + shadow(80, 15),
  hold: { k: 'db' },
  order: STANDING,
  primary: 'arms',
  muscles: ['זרוע קדמית'],
  camera: [44, 20, 72, 90],
  arcShift: [8, 0],
};

const A6: ExerciseDemo = {
  id: 'a6',
  view: 'side',
  facing: 1,
  loopMs: 3000,
  forwardShare: 0.45,
  // Hanging knee raise: the hands stay on the bar in both frames, the knees
  // come to the chest and the pelvis tilts up (torso -90 → -100) at the top.
  frames: [
    { x: 83, y: 63, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [92, 90, 25], legF: [88, 92, 25] },
    { x: 83, y: 61, torso: -100, head: -45, arm: [-100, -65.2], armF: [-90.7, -63.5], leg: [-32.7, 60, 10], legF: [-28, 64, 10] },
  ],
  props: () => pullBar(60, 106, 12, 6),
  hold: { k: 'none' },
  order: STANDING,
  primary: 'core',
  muscles: ['בטן תחתונה'],
  camera: [52, 4, 68, 104],
  // nothing is held: the movement IS the knees, so that is what the guide traces
  arcFrom: 'knee',
};

/* ------------------------------------------------------------------ day B */

const B1: ExerciseDemo = {
  id: 'b1',
  view: 'side',
  facing: -1,
  loopMs: 2800,
  forwardShare: 0.42,
  // Flat Smith bench: the bar cannot leave the rail, so both keyframes put the
  // hands on x=92 and only the height changes.
  frames: [
    { x: 74, y: 78, torso: 0, head: 0, arm: [-214.4, -70.6], armF: [-205.2, -55.3], leg: [166.4, 88.1, 155], legF: [166.4, 89.6, 155] },
    { x: 74, y: 78, torso: 0, head: 0, arm: [-121.3, -86.2], armF: [-118.9, -78.4], leg: [166.4, 88.1, 155], legF: [166.4, 89.6, 155] },
  ],
  props: () => floor(26, 146) + rail(92, 24, 94) + flatBench({ x: 64, y: 84, len: 56 }),
  hold: { k: 'bar' },
  order: SUPINE,
  primary: 'chest',
  secondary: 'arms',
  face: 'back',
  muscles: ['חזה', 'תלת ראשי'],
  camera: [34, 30, 94, 76],
};

const B2: ExerciseDemo = {
  id: 'b2',
  view: 'side',
  facing: 1,
  loopMs: 3000,
  forwardShare: 0.44,
  // Pull-up: the grip is fixed on the bar and the BODY travels — the pelvis
  // rises 17 and the chin arrives level with the bar. At the top the head tips
  // BACK rather than straight up: a skull drawn directly under the fists is a
  // skull you cannot see, and looking up is what the movement asks for anyway.
  frames: [
    { x: 84, y: 65, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [95, 85, 30], legF: [100, 80, 30] },
    { x: 86, y: 48, torso: -97, head: -112, arm: [-11.7, -142.5], armF: [-1.3, -130], leg: [100, 70, 30], legF: [105, 65, 30] },
  ],
  props: () => pullBar(58, 110, 14, 6),
  hold: { k: 'none' },
  order: STANDING,
  primary: 'back',
  secondary: 'arms',
  muscles: ['גב רחב', 'זרוע קדמית'],
  camera: [50, 4, 76, 108],
  // the chin is what has to reach the bar, so the chin is what the guide follows
  arcFrom: 'head',
  arcShift: [11, 0],
};

const B3: ExerciseDemo = {
  id: 'b3',
  view: 'side',
  facing: 1,
  loopMs: 2800,
  forwardShare: 0.58,
  // Dip: hands fixed on the bars, torso held at the ~30° forward lean the steps
  // ask for, body descends 15 to a right angle at the elbow.
  frames: [
    { x: 74, y: 47, torso: -60, head: -60, arm: [119.3, 64.7], armF: [113, 59.5], leg: [110, 30, -25], legF: [115, 25, -30] },
    { x: 74, y: 62, torso: -58, head: -58, arm: [173.8, 35], armF: [159, 20.8], leg: [110, 30, -25], legF: [115, 25, -30] },
  ],
  props: () => floor(52, 120) + dipBars(66, 106, 52, FLOOR),
  hold: { k: 'none' },
  order: STANDING,
  primary: 'chest',
  secondary: 'arms',
  face: 'back',
  muscles: ['חזה תחתון', 'תלת ראשי'],
  camera: [52, 4, 68, 100],
  // bodyweight: the load is the hips, and they travel straight down
  arcFrom: 'hip',
  arcShift: [-13, 0],
};

const B4: ExerciseDemo = {
  id: 'b4',
  view: 'side',
  facing: 1,
  loopMs: 2800,
  forwardShare: 0.44,
  // Bent-over row in the Smith: the torso is hinged to 45° and stays there —
  // no body english — and the bar runs up the rail to the lower chest.
  frames: [
    { x: 76, y: 66, torso: -45, head: -45, arm: [92.7, 87.5], armF: [84.8, 84.8], leg: [85.2, 109.8, 25], legF: [86.4, 110, 25] },
    { x: 76, y: 66, torso: -45, head: -45, arm: [161.5, 34.1], armF: [149.4, 23.2], leg: [85.2, 109.8, 25], legF: [86.4, 110, 25] },
  ],
  props: () => floor(40, 128) + rail(93, 26, 96),
  hold: { k: 'bar' },
  order: STANDING,
  primary: 'back',
  secondary: 'arms',
  muscles: ['עובי גב', 'זרוע קדמית'],
  camera: [44, 28, 76, 80],
  // the bar runs up the rail, and the arm hangs over the rail: nudge the guide
  // clear of both so the direction of travel is readable
  arcShift: [9, 0],
};

const B5: ExerciseDemo = {
  id: 'b5',
  view: 'side',
  facing: 1,
  loopMs: 4200,
  forwardShare: 0.5,
  // Plank: a HOLD, so the two frames differ by ~1 unit of breathing — and the
  // breath moves the HIPS while the shoulders and the planted elbows stay
  // exactly where they are. Ear, hip and heel sit on one line in both frames,
  // which is the difference between the cue and the mistake.
  frames: [
    { x: 76.2, y: 87.2, torso: -7.6, head: -14, arm: [90, 0], armF: [92, 2], leg: [172.5, 172.5, 90], legF: [174, 171, 90] },
    { x: 76.2, y: 88.4, torso: -10.5, head: -17, arm: [90, 0], armF: [92, 2], leg: [174.6, 174.6, 90], legF: [176, 173, 90] },
  ],
  props: () => floor(26, 146, 103.4) + mat(36, 124, 99),
  hold: { k: 'none' },
  order: SUPINE,
  primary: 'core',
  muscles: ['ליבה'],
  camera: [28, 52, 104, 60],
  // a hold has no load path, and a 1-unit arrow would be noise
  arcFrom: 'none',
};

const B6: ExerciseDemo = {
  id: 'b6',
  view: 'front',
  facing: 1,
  loopMs: 3000,
  forwardShare: 0.44,
  // Crossover, seen from the front so the arc is visible: high and wide, then
  // the hands meet in front of the belly. Both cables come from their own high
  // pulley and follow the hands.
  frames: [
    { x: 80, y: 68, torso: -90, head: -90, arm: [18.3, -23.8], armF: [18.3, -23.8], leg: [85, 88, 20], legF: [85, 88, 20] },
    { x: 80, y: 68, torso: -90, head: -90, arm: [99.5, 99.5], armF: [99.5, 99.5], leg: [85, 88, 20], legF: [85, 88, 20] },
  ],
  props: () =>
    floor(34, 126) +
    pulley(30, 24, { top: 10, post: 46, stack: true }) +
    pulley(130, 24, { top: 10, post: 46, stack: true }),
  hold: { k: 'cables', from: [[30, 24], [130, 24]] },
  order: FRONTAL,
  primary: 'chest',
  muscles: ['חזה פנימי'],
  camera: [20, 8, 120, 100],
};

/* ------------------------------------------------------------------ day C */

/**
 * c1 · THE SAME 30° INCLINE AS a1, taken to the range its own steps promise:
 * "deeper than the bar". The bottom frame drops the elbow further below the
 * shoulder line than a1's does, and the camera is a step tighter on the chest so
 * the stretch is the thing you look at.
 */
const C1_BASE = { x: 69, y: 79.5, torso: -30, head: -30, leg: [168, 83, 176], legF: [171, 85, 176] } as const;

const C1: ExerciseDemo = {
  id: 'c1',
  view: 'side',
  facing: -1,
  loopMs: 3400,
  forwardShare: 0.4,
  frames: [
    { ...C1_BASE, arm: [-222, -70], armF: [-216, -62] },
    { ...C1_BASE, arm: [-180, -88], armF: [-178, -80] },
    { ...C1_BASE, arm: [-138.5, -103.7], armF: [-140.9, -92.6] },
  ],
  props: () => floor(26, 148) + inclineBench({ x: 66, y: 85, len: 46, angle: -30, seat: 11 }),
  hold: { k: 'db' },
  order: ['farArm', 'farLeg', 'body', 'nearLeg', 'nearArm'],
  primary: 'chest',
  secondary: 'arms',
  muscles: ['חזה עליון · טווח מלא', 'תלת ראשי'],
  camera: [30, 30, 98, 74],
};

/**
 * c2 · ROMANIAN DEADLIFT. The planted foot is the whole lift: every frame's leg
 * was solved back from the ankle at (80, 98.4), the one point this hinge pivots
 * around. The far leg takes the same solution ±1.5°, which at a 17-unit thigh
 * moves its ankle by less than half a unit — a stance, not a limp.
 *
 * Signed off with the volumetric renderer and carried across unchanged.
 */
const C2_TOE = 4;

function c2Leg(thigh: number, shin: number): Pick<Pose, 'leg' | 'legF'> {
  return { leg: [thigh, shin, C2_TOE], legF: [thigh + 1.5, shin - 1.5, C2_TOE] };
}

const C2: ExerciseDemo = {
  id: 'c2',
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
  props: () => floor(30, 140) + shadow(80, 17),
  hold: { k: 'db' },
  // standing, the near arm hangs OVER the torso and the far arm behind it
  order: ['farLeg', 'farArm', 'body', 'nearLeg', 'nearArm'],
  primary: 'legs',
  secondary: 'back',
  muscles: ['ירך אחורית · ישבן', 'זוקפי גב'],
  // a standing lift is TALL: this stage is nearly square, which is the whole
  // reason the camera is per-demo — a 4:3 crop would spend half its pixels on
  // empty air either side of a vertical body
  camera: [37.5, 19, 80, 85],
  // the hanging arm sits ON the load path for most of this rep: move the guide
  // a hand's width in front of the body so it can be seen at all
  arcShift: [10, 0],
};

const C3: ExerciseDemo = {
  id: 'c3',
  view: 'side',
  facing: 1,
  loopMs: 2800,
  forwardShare: 0.42,
  // Seated shoulder press: from ear height to overhead, spine on the backrest.
  frames: [
    { x: 74, y: 80, torso: -80, head: -80, arm: [26.2, -98.4], armF: [27, -88.5], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
    { x: 74, y: 80, torso: -80, head: -80, arm: [-63.1, -98.5], armF: [-61.5, -90], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
  ],
  // the backrest is set a full torso-width behind the spine, or the body simply
  // covers it and the lifter reads as sitting on nothing
  props: () => floor(34, 128) + uprightBench({ x: 64, y: 86, back: 34, seat: 28 }),
  hold: { k: 'db' },
  order: STANDING,
  primary: 'shoulders',
  secondary: 'arms',
  face: 'back',
  muscles: ['כתף קדמית ואמצעית', 'תלת ראשי'],
  camera: [44, 18, 74, 90],
};

const C4: ExerciseDemo = {
  id: 'c4',
  view: 'side',
  facing: 1,
  loopMs: 2600,
  forwardShare: 0.42,
  // Overhead extension: the upper arm is frozen in BOTH frames (elbows stay
  // tucked and pointing forward) and only the forearm swings behind the head and
  // back up. One dumbbell in both hands, so it rides the midpoint. The elbows
  // are carried a few degrees further forward, and the head tipped a few back,
  // than a stick figure needed: a solid upper arm drawn straight over a solid
  // skull erases the skull.
  frames: [
    { x: 74, y: 80, torso: -85, head: -100, arm: [-58, 159.3], armF: [-62, 159], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
    { x: 74, y: 80, torso: -85, head: -100, arm: [-58, 278.3], armF: [-62, 282.3], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
  ],
  props: () => floor(34, 128) + uprightBench({ x: 64, y: 86, back: 34, seat: 28 }),
  hold: { k: 'plate', r: 5 },
  order: STANDING,
  primary: 'arms',
  face: 'back',
  muscles: ['תלת ראשי'],
  camera: [44, 16, 74, 92],
};

const C5: ExerciseDemo = {
  id: 'c5',
  view: 'side',
  facing: -1,
  loopMs: 2600,
  forwardShare: 0.44,
  // Crunch: the PELVIS never moves — the spine curls (torso 0 → -30) and the
  // head tucks, which is the difference between a crunch and a sit-up. The
  // elbows point straight UP and the plate rides over the sternum: the arms were
  // re-solved to clear the skull, because a forearm drawn across the face costs
  // the one part of this pose that says which way the spine is curling.
  frames: [
    { x: 66, y: 95, torso: 0, head: 0, arm: [-84, -174.2], armF: [-81.1, -177.6], leg: [-118.1, 111.8, 120], legF: [-114, 108, 120] },
    { x: 66, y: 95, torso: -30, head: -45, arm: [-87, -181.8], armF: [-84.7, -185.3], leg: [-118.1, 111.8, 120], legF: [-114, 108, 120] },
  ],
  props: () => floor(28, 136, 103.4) + mat(38, 118, 99),
  hold: { k: 'plate', r: 5 },
  order: SUPINE,
  primary: 'core',
  muscles: ['בטן עליונה'],
  camera: [36, 46, 80, 62],
};

const C6: ExerciseDemo = {
  id: 'c6',
  view: 'front',
  facing: 1,
  loopMs: 3400,
  forwardShare: 0.5,
  // Russian twist, three frames: right → centre → left, whose yoyo is the full
  // sweep. The seat is on the mat, the knees are up and out with the heels on
  // the mat in front, and the weight is carried in front of the STERNUM — the
  // arms were re-solved so the far one reaches across the body on every turn,
  // which is what makes a twist read as a twist rather than as a lean. The rotation is a shoulder-line ROLL (±25°), i.e. it is led from the
  // ribs — the arms keep the weight in front of the sternum the whole way.
  frames: [
    { x: 80, y: 92, torso: -90, head: -90, arm: [42.1, 117.5], armF: [106.4, 171.7], leg: [-79.7, 66.7, 60], legF: [-79.7, 66.7, 60], roll: -25 },
    { x: 80, y: 92, torso: -90, head: -90, arm: [72, 148.2], armF: [72, 148.2], leg: [-79.7, 66.7, 60], legF: [-79.7, 66.7, 60], roll: 0 },
    { x: 80, y: 92, torso: -90, head: -90, arm: [106.4, 171.7], armF: [42.1, 117.5], leg: [-79.7, 66.7, 60], legF: [-79.7, 66.7, 60], roll: 25 },
  ],
  props: () => mat(44, 116, 95),
  hold: { k: 'plate' },
  order: FRONTAL,
  primary: 'core',
  muscles: ['אלכסונים'],
  camera: [54, 44, 56, 60],
};

/* ---------------------------------------------------------------- library */

const X1: ExerciseDemo = {
  id: 'x1',
  view: 'side',
  facing: 1,
  loopMs: 3200,
  forwardShare: 0.58,
  // Smith squat: the bar is on the shoulders, and because the rail is vertical
  // the shoulder x is the SAME in every frame (78) — the hips travel back and
  // down under it until the thigh is parallel. The middle frame is solved from
  // the same planted ankle as the other two, which is what keeps the shoe still
  // through the descent instead of letting a straight lerp drag it.
  frames: [
    { x: 78, y: 68, torso: -90, head: -90, arm: [120, -100], armF: [124, -104], leg: [61.9, 90, 20], legF: [62, 91.4, 20] },
    { x: 74.7, y: 76, torso: -82, head: -82, arm: [120, -100], armF: [124, -104], leg: [26.2, 104.3, 20], legF: [26.4, 105.7, 20] },
    { x: 72, y: 84, torso: -75, head: -75, arm: [120, -100], armF: [124, -104], leg: [-2.4, 100.8, 20], legF: [-2.1, 102.2, 20] },
  ],
  props: () => floor(40, 122) + rail(78, 14, 98),
  hold: { k: 'barBack' },
  order: STANDING,
  primary: 'legs',
  face: 'front',
  muscles: ['ארבע ראשי · ישבן'],
  camera: [50, 16, 58, 90],
};

const X2: ExerciseDemo = {
  id: 'x2',
  view: 'side',
  facing: 1,
  loopMs: 2600,
  forwardShare: 0.42,
  // Leg extension: the KNEE sits on the machine's pivot and does not move; only
  // the shin rotates, and the roller pad rides the ankle.
  frames: [
    { x: 66, y: 80, torso: -100, head: -100, arm: [95, 95], armF: [92, 92], leg: [0, 90, 0], legF: [-3, 93, 0] },
    { x: 66, y: 80, torso: -100, head: -100, arm: [95, 95], armF: [92, 92], leg: [0, 5, -20], legF: [-3, 8, -20] },
  ],
  props: () => floor(34, 126) + legExtensionStation(FLOOR),
  hold: { k: 'roller', joint: 'ankle' },
  order: STANDING,
  primary: 'legs',
  face: 'front',
  muscles: ['ארבע ראשי'],
  camera: [38, 32, 84, 76],
};

const X3: ExerciseDemo = {
  id: 'x3',
  view: 'side',
  facing: -1,
  loopMs: 2600,
  forwardShare: 0.42,
  // Lying leg curl: face down, hips pinned to the pad (the pelvis is identical
  // in both frames) and only the shin curls up against the roller. The arms hang
  // off the near side and grip UNDER the pad, which is both what a lifter does
  // and the one place they do not cross the face.
  frames: [
    { x: 84, y: 80, torso: 180, head: 180, arm: [141.3, 30], armF: [144, 33], leg: [0, 0, 30], legF: [3, 3, 30] },
    { x: 84, y: 80, torso: 180, head: 180, arm: [141.3, 30], armF: [144, 33], leg: [0, -80, -50], legF: [3, -76, -46] },
  ],
  props: () => floor(28, 140) + legCurlStation(FLOOR),
  hold: { k: 'roller', joint: 'ankle' },
  order: SUPINE,
  primary: 'legs',
  muscles: ['ירך אחורית'],
  camera: [32, 46, 92, 62],
};

const X4: ExerciseDemo = {
  id: 'x4',
  view: 'front',
  facing: 1,
  loopMs: 2400,
  forwardShare: 0.42,
  // Lateral raise: the only lift here that MUST be seen from the front — from
  // the side the whole movement happens straight at the camera.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [85, 88], armF: [85, 88], leg: [85, 88, 20], legF: [85, 88, 20] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [-5, 12], armF: [-5, 12], leg: [85, 88, 20], legF: [85, 88, 20] },
  ],
  props: () => floor(40, 120) + shadow(80, 17),
  hold: { k: 'db' },
  order: FRONTAL,
  primary: 'shoulders',
  muscles: ['כתף אמצעית'],
  camera: [30, 22, 100, 88],
};

const X5: ExerciseDemo = {
  id: 'x5',
  view: 'side',
  facing: 1,
  loopMs: 2400,
  forwardShare: 0.42,
  // Rope pushdown: the upper arm is frozen at 95 in both frames — the cue is
  // "only the forearm moves" — and the rope runs to the high pulley.
  frames: [
    { x: 76, y: 66, torso: -85, head: -80, arm: [95, -10], armF: [92, -14], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 76, y: 66, torso: -85, head: -80, arm: [95, 80], armF: [92, 84], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => floor(44, 126) + pulley(102, 18, { stack: true }),
  hold: { k: 'rope', from: [102, 18] },
  order: STANDING,
  primary: 'arms',
  face: 'back',
  muscles: ['תלת ראשי'],
  camera: [46, 10, 76, 98],
};

const X6: ExerciseDemo = {
  id: 'x6',
  view: 'side',
  facing: 1,
  loopMs: 2800,
  forwardShare: 0.44,
  // Close-grip pulldown: seated under the thigh pad, the handle travels from
  // overhead down to the chest.
  frames: [
    { x: 66, y: 80, torso: -83, head: -83, arm: [-32.1, -64.6], armF: [-45.7, -45.7], leg: [15, 85, 5], legF: [12, 88, 5] },
    { x: 66, y: 80, torso: -83, head: -83, arm: [105.1, -19.6], armF: [93.2, -21.4], leg: [15, 85, 5], legF: [12, 88, 5] },
  ],
  props: () => floor(34, 134) + pulldownSeat(FLOOR) + pulley(112, 14, { top: 6, post: 40, stack: true }),
  hold: { k: 'handle', from: [112, 14] },
  order: STANDING,
  primary: 'back',
  secondary: 'arms',
  muscles: ['גב רחב', 'זרוע קדמית'],
  camera: [46, 4, 80, 102],
};

const X7: ExerciseDemo = {
  id: 'x7',
  view: 'side',
  facing: 1,
  loopMs: 2600,
  forwardShare: 0.44,
  // OUR face pull, and the sagittal plane is the only one that can show it: the
  // rope starts at a pulley set to FACE height with the arms extended, and
  // finishes at the forehead with the elbows driven back and up to shoulder
  // level — high elbows are the whole cue, and from the front they would be
  // pointing straight at the camera.
  frames: [
    { x: 70, y: 66, torso: -90, head: -90, arm: [18, -31.9], armF: [5.3, -12.1], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 70, y: 66, torso: -90, head: -90, arm: [-134.7, -1.5], armF: [-118.3, 14.5], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => floor(40, 136) + pulley(122, 34, { top: 12, post: 32, stack: true }),
  hold: { k: 'rope', from: [122, 34] },
  // the rope finishes AT the face: the near forearm crosses it, so the arm goes
  // behind the head and the fists come back out beside it
  order: ARMS_BEHIND,
  primary: 'shoulders',
  secondary: 'back',
  muscles: ['כתף אחורית', 'טרפז אמצעי'],
  camera: [44, 14, 86, 92],
};

const X8: ExerciseDemo = {
  id: 'x8',
  view: 'front',
  facing: 1,
  loopMs: 2200,
  forwardShare: 0.45,
  // Shrug: nothing rotates at all. The shoulder line rises 6 along the spine
  // (`shrug`) and the straight arms — and the dumbbells — ride up with it.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [88, 90], armF: [88, 90], leg: [85, 88, 20], legF: [85, 88, 20], shrug: 0 },
    { x: 80, y: 66, torso: -90, head: -90, arm: [88, 90], armF: [88, 90], leg: [85, 88, 20], legF: [85, 88, 20], shrug: 6 },
  ],
  props: () => floor(44, 116) + shadow(80, 15),
  hold: { k: 'db' },
  order: FRONTAL,
  primary: 'back',
  muscles: ['טרפז עליון'],
  camera: [42, 20, 76, 88],
};

const X9: ExerciseDemo = {
  id: 'x9',
  view: 'side',
  facing: 1,
  loopMs: 2400,
  forwardShare: 0.42,
  // Hammer curl: the same pinned elbow and the same arc as a5 — because it IS
  // the same arc. What tells them apart is the grip, so the dumbbell is drawn
  // ALONG the forearm (neutral, thumbs up) instead of across it, which from the
  // side means you see the whole bell broadside instead of foreshortened.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, 90], armF: [88, 90], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, -60], armF: [88, -64], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => floor(46, 116) + shadow(80, 15),
  hold: { k: 'db', axis: 'along' },
  order: STANDING,
  primary: 'arms',
  muscles: ['זרוע קדמית · אמה'],
  camera: [44, 20, 72, 90],
  arcShift: [8, 0],
};

const X10: ExerciseDemo = {
  id: 'x10',
  view: 'side',
  facing: -1,
  loopMs: 3000,
  forwardShare: 0.42,
  // Pullover: one dumbbell in both hands travelling a wide ARC from behind the
  // head to over the chest, with the elbow bend held constant throughout.
  frames: [
    { x: 72, y: 78, torso: 0, head: 0, arm: [-58.7, -14.8], armF: [-32.2, -32.2], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
    { x: 72, y: 78, torso: 0, head: 0, arm: [-117.5, -75.7], armF: [-112.6, -69.7], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
  ],
  props: () => floor(28, 146) + flatBench({ x: 62, y: 84, len: 58 }),
  hold: { k: 'plate', r: 6 },
  order: SUPINE,
  primary: 'chest',
  secondary: 'back',
  muscles: ['חזה', 'גב רחב'],
  camera: [34, 26, 96, 80],
};

/** Every demonstration, in program order. */
export const EXERCISE_DEMOS: readonly ExerciseDemo[] = [
  A1, A2, A3, A4, A5, A6,
  B1, B2, B3, B4, B5, B6,
  C1, C2, C3, C4, C5, C6,
  X1, X2, X3, X4, X5, X6, X7, X8, X9, X10,
];

const BY_ID: ReadonlyMap<string, ExerciseDemo> = new Map(EXERCISE_DEMOS.map((d) => [d.id, d]));

/**
 * The demonstration for an exercise id, or `null`.
 *
 * `null` is the ANSWER for a custom exercise (`cx_…`): the user invented the
 * movement, we have no idea what it looks like, and a generic figure waving at
 * them would be worse than nothing. The workout screen renders no demo block at
 * all in that case rather than a placeholder.
 */
export function demoFor(exId: string): ExerciseDemo | null {
  return BY_ID.get(exId) ?? null;
}
