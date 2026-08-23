/**
 * data/exercisePoses.ts — one looping demonstration per built-in exercise.
 *
 * A demo is DATA, not media: a view (which plane the camera is on), two to
 * three keyframes of joint angles for `ui/coachFigure.ts`, the props the lift
 * happens on, what the hands are holding, and a rep tempo. Roughly 6 kB of
 * numbers for all 28 exercises — the whole feature ships without a single byte
 * of image, video or font, which is what keeps the single-file build honest.
 *
 * THE KEYFRAMES ARE A YOYO. `frames` lists the rep in ONE direction (usually
 * start → finish) and `ui/exerciseDemo.ts` plays it there and back with a cosine
 * ease, which is exactly what a controlled rep looks like: slow at both ends,
 * quickest through the middle. Two frames are a press; three are a movement
 * with a meaningful middle (the russian twist: right → centre → left, whose
 * yoyo is the full side-to-side sweep).
 *
 * THE ANGLES WERE AUTHORED GEOMETRICALLY — each keyframe was solved so that the
 * hands land on the bar/handle/dumbbell position the movement actually calls
 * for, and consecutive keyframes are kept inside one continuous angular range
 * so a straight lerp rotates a joint the short, correct way (this is why some
 * angles read as -210 rather than 150: the value is what makes the NEXT frame a
 * 90° turn instead of a 270° one). What guards them is not the derivation but
 * `tests/exercisePoses.test.ts`, which re-derives the joint positions from the
 * shipped numbers and asserts the movement: a bench press's wrists above the
 * chest at the bottom and the arm extended at the top, a squat's hips below the
 * knees, an RDL's hinge with a nearly straight knee, a curl's pinned elbow, a
 * cable that starts at the pulley the props drew.
 *
 * WE ANIMATE OUR OWN COACHING COPY. Where `data/program.ts` teaches a specific
 * variant, the demo follows THAT — a1 is the Smith rail (a fixed vertical bar
 * path) while c1 is the same incline with dumbbells and a deeper stretch; the
 * face pull is pulled to face height with high elbows because that is what our
 * steps say; b2 is drawn as the pull-up its steps describe.
 *
 * A custom exercise (`cx_…`) has no entry here on purpose — see `demoFor`.
 */

import {
  barProp,
  benchProp,
  dipBarsProp,
  floorProp,
  frameProp,
  matProp,
  padProp,
  pivotProp,
  pulleyProp,
  railProp,
  type Hold,
  type Pose,
  type View,
} from '../ui/coachFigure.ts';

export interface ExerciseDemo {
  /** The exercise id this demonstrates (`data/program.ts`). */
  readonly id: string;
  readonly view: View;
  /** One full rep, there and back, in milliseconds. */
  readonly loopMs: number;
  /** The rep in one direction; played as a yoyo. At least two. */
  readonly frames: readonly Pose[];
  /** The station: bench, rail, pulley, mat, floor. Static for the whole loop. */
  readonly props: () => string;
  /** What the hands are on. Positioned from the pose, never authored twice. */
  readonly hold: Hold;
}

/* ------------------------------------------------------------ shared props */

const FLOOR = 102;
const flatBench = (x: number, len: number): string => benchProp({ x, y: 84, len, floorY: FLOOR });
const inclineBench = (): string => benchProp({ x: 66, y: 84, len: 46, angle: -30, seat: 16, floorY: FLOOR });
const uprightBench = (): string => benchProp({ x: 68, y: 84, len: 34, angle: -85, seat: 16, floorY: FLOOR });

/* ------------------------------------------------------------------ day A */

const A1: ExerciseDemo = {
  id: 'a1',
  view: 'side',
  loopMs: 2600,
  // Smith incline press: the bar CANNOT leave the rail, so both keyframes put
  // the hands on x=84 and only the height changes — bar at the upper chest,
  // then pressed to just short of lockout.
  frames: [
    { x: 68, y: 81, torso: -30, head: -30, arm: [-210.9, -64], armF: [-198.6, -46.8], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
    { x: 68, y: 81, torso: -30, head: -30, arm: [-120.5, -82.4], armF: [-117.1, -75.2], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
  ],
  props: () => inclineBench() + railProp(84, 28, 92) + floorProp(30, 140),
  hold: { k: 'bar' },
};

const A2: ExerciseDemo = {
  id: 'a2',
  view: 'side',
  loopMs: 2600,
  // One-arm row: the FAR side is the support (knee and hand on the bench) and
  // never moves; only the near arm rows the dumbbell to the hip pocket.
  frames: [
    { x: 100, y: 68, torso: 182, head: 182, arm: [83.5, 95.7], armF: [82.8, 167.2], leg: [62.7, 96.5, 25], legF: [98, 0, 65] },
    { x: 100, y: 68, torso: 182, head: 182, arm: [-32.2, 64.9], armF: [82.8, 167.2], leg: [62.7, 96.5, 25], legF: [98, 0, 65] },
  ],
  props: () => flatBench(48, 76) + floorProp(30, 140),
  hold: { k: 'dbNear' },
};

const A3: ExerciseDemo = {
  id: 'a3',
  view: 'side',
  loopMs: 2800,
  // Split squat: the feet are planted in both frames, the pelvis drops 12 and
  // the front thigh arrives parallel with the shin vertical.
  frames: [
    { x: 72, y: 71, torso: -87, head: -87, arm: [90, 90], armF: [92, 90], leg: [44.9, 90.1, 25], legF: [89.7, 141.3, 45] },
    { x: 66, y: 83, torso: -87, head: -87, arm: [90, 90], armF: [92, 90], leg: [0.1, 86.4, 25], legF: [55.7, 176.6, 45] },
  ],
  props: () => floorProp(36, 120),
  hold: { k: 'db' },
};

const A4: ExerciseDemo = {
  id: 'a4',
  view: 'side',
  loopMs: 2800,
  // Flye: the arms open into a wide V, each hand dropping past its own side of
  // the bench, then close over the chest — the honest way to draw a transverse
  // arc from the side, with the soft elbow held bent the whole way.
  frames: [
    { x: 72, y: 78, torso: 0, head: 0, arm: [98.5, 25.4], armF: [84, 162.8], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
    { x: 72, y: 78, torso: 0, head: 0, arm: [237.7, -70.3], armF: [-61.9, 220.6], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
  ],
  props: () => flatBench(46, 74) + floorProp(30, 140),
  hold: { k: 'db' },
};

const A5: ExerciseDemo = {
  id: 'a5',
  view: 'side',
  loopMs: 2200,
  // Curl: the upper arm is IDENTICAL in both frames (elbow pinned to the ribs)
  // and only the forearm rotates. Zero body sway — the pelvis never moves.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, 90], armF: [88, 90], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, -60], armF: [88, -64], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => floorProp(48, 112),
  hold: { k: 'db' },
};

const A6: ExerciseDemo = {
  id: 'a6',
  view: 'side',
  loopMs: 2800,
  // Hanging knee raise: the hands stay on the bar in both frames, the knees
  // come to the chest and the pelvis tilts up (torso -90 → -100) at the top.
  frames: [
    { x: 83, y: 63, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [92, 90, 25], legF: [88, 92, 25] },
    { x: 83, y: 61, torso: -100, head: -45, arm: [-100, -65.2], armF: [-90.7, -63.5], leg: [-32.7, 60, 10], legF: [-28, 64, 10] },
  ],
  props: () => barProp(60, 106, 10, 6),
  hold: { k: 'none' },
};

/* ------------------------------------------------------------------ day B */

const B1: ExerciseDemo = {
  id: 'b1',
  view: 'side',
  loopMs: 2600,
  frames: [
    { x: 74, y: 78, torso: 0, head: 0, arm: [-214.4, -70.6], armF: [-205.2, -55.3], leg: [166.4, 88.1, 155], legF: [166.4, 89.6, 155] },
    { x: 74, y: 78, torso: 0, head: 0, arm: [-121.3, -86.2], armF: [-118.9, -78.4], leg: [166.4, 88.1, 155], legF: [166.4, 89.6, 155] },
  ],
  props: () => flatBench(44, 74) + railProp(92, 24, 92) + floorProp(28, 140),
  hold: { k: 'bar' },
};

const B2: ExerciseDemo = {
  id: 'b2',
  view: 'side',
  loopMs: 2800,
  // Pull-up: the grip is fixed on the bar and the BODY travels — the pelvis
  // rises 17 and the chin arrives level with the bar.
  frames: [
    { x: 84, y: 65, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [95, 85, 30], legF: [100, 80, 30] },
    { x: 86, y: 48, torso: -97, head: -85, arm: [-11.7, -142.5], armF: [-1.3, -130], leg: [100, 70, 30], legF: [105, 65, 30] },
  ],
  props: () => barProp(58, 110, 12, 6),
  hold: { k: 'none' },
};

const B3: ExerciseDemo = {
  id: 'b3',
  view: 'side',
  loopMs: 2600,
  // Dip: hands fixed on the bars, torso held at the ~30° forward lean the steps
  // ask for, body descends 15 to a right angle at the elbow.
  frames: [
    { x: 74, y: 47, torso: -60, head: -60, arm: [119.3, 64.7], armF: [113, 59.5], leg: [110, 30, -25], legF: [115, 25, -30] },
    { x: 74, y: 62, torso: -58, head: -58, arm: [173.8, 35], armF: [159, 20.8], leg: [110, 30, -25], legF: [115, 25, -30] },
  ],
  props: () => dipBarsProp(66, 106, 52, FLOOR),
  hold: { k: 'none' },
};

const B4: ExerciseDemo = {
  id: 'b4',
  view: 'side',
  loopMs: 2600,
  // Bent-over row in the Smith: the torso is hinged to 45° and stays there —
  // no body english — and the bar runs up the rail to the lower chest.
  frames: [
    { x: 76, y: 66, torso: -45, head: -45, arm: [92.7, 87.5], armF: [84.8, 84.8], leg: [85.2, 109.8, 25], legF: [86.4, 110, 25] },
    { x: 76, y: 66, torso: -45, head: -45, arm: [161.5, 34.1], armF: [149.4, 23.2], leg: [85.2, 109.8, 25], legF: [86.4, 110, 25] },
  ],
  props: () => railProp(93, 26, 94) + floorProp(40, 124),
  hold: { k: 'bar' },
};

const B5: ExerciseDemo = {
  id: 'b5',
  view: 'side',
  loopMs: 4200,
  // Plank: a HOLD, so the two frames differ by ~1 unit of breathing — and the
  // breath moves the HIPS while the shoulders and the planted elbows stay
  // exactly where they are. Ear, hip and heel sit on one line in both frames,
  // which is the difference between the cue and the mistake.
  frames: [
    { x: 76.2, y: 87.2, torso: -7.6, head: -14, arm: [90, 0], armF: [92, 2], leg: [172.5, 172.5, 90], legF: [174, 171, 90] },
    { x: 76.2, y: 88.4, torso: -10.5, head: -17, arm: [90, 0], armF: [92, 2], leg: [174.6, 174.6, 90], legF: [176, 173, 90] },
  ],
  props: () => matProp(38, 122, 100) + floorProp(30, 140, 103.4),
  hold: { k: 'none' },
};

const B6: ExerciseDemo = {
  id: 'b6',
  view: 'front',
  loopMs: 2800,
  // Crossover, seen from the front so the arc is visible: high and wide, then
  // the hands meet in front of the belly. Both cables come from their own high
  // pulley and follow the hands.
  frames: [
    { x: 80, y: 68, torso: -90, head: -90, arm: [18.3, -23.8], armF: [18.3, -23.8], leg: [85, 88, 20], legF: [85, 88, 20] },
    { x: 80, y: 68, torso: -90, head: -90, arm: [99.5, 99.5], armF: [99.5, 99.5], leg: [85, 88, 20], legF: [85, 88, 20] },
  ],
  props: () => pulleyProp(24, 26, { stack: true }) + pulleyProp(136, 26, { stack: true }) + floorProp(36, 124),
  hold: { k: 'cables', from: [[24, 26], [136, 26]] },
};

/* ------------------------------------------------------------------ day C */

const C1: ExerciseDemo = {
  id: 'c1',
  view: 'side',
  loopMs: 2800,
  // The same 30° incline as a1, but with dumbbells: no rail, so the path is
  // perpendicular to the torso and the bottom is DEEPER than the bar allows.
  frames: [
    { x: 68, y: 81, torso: -30, head: -30, arm: [-208.1, -82.1], armF: [-204.7, -70.9], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
    { x: 68, y: 81, torso: -30, head: -30, arm: [-138.5, -103.7], armF: [-140.9, -92.6], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
  ],
  props: () => inclineBench() + floorProp(30, 140),
  hold: { k: 'db' },
};

const C2: ExerciseDemo = {
  id: 'c2',
  view: 'side',
  loopMs: 2800,
  // RDL: the hips travel BACK 14 while the knee keeps its small fixed bend and
  // the arms simply hang, so the dumbbells track down the shins by themselves.
  frames: [
    { x: 62, y: 66, torso: -90, head: -90, arm: [90, 90], armF: [92, 90], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 48, y: 70, torso: -15, head: -25, arm: [90, 90], armF: [92, 90], leg: [51.8, 77.8, 25], legF: [51.8, 77.8, 25] },
  ],
  props: () => floorProp(34, 118),
  hold: { k: 'db' },
};

const C3: ExerciseDemo = {
  id: 'c3',
  view: 'side',
  loopMs: 2600,
  frames: [
    { x: 74, y: 80, torso: -80, head: -80, arm: [26.2, -98.4], armF: [27, -88.5], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
    { x: 74, y: 80, torso: -80, head: -80, arm: [-63.1, -98.5], armF: [-61.5, -90], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
  ],
  props: () => uprightBench() + floorProp(36, 124),
  hold: { k: 'db' },
};

const C4: ExerciseDemo = {
  id: 'c4',
  view: 'side',
  loopMs: 2400,
  // Overhead extension: the upper arm is frozen at -75 in BOTH frames (elbows
  // stay tucked and pointing forward) and only the forearm swings behind the
  // head and back up. One dumbbell in both hands, so it rides the midpoint.
  frames: [
    { x: 74, y: 80, torso: -85, head: -85, arm: [-75, 150], armF: [-79, 154], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
    { x: 74, y: 80, torso: -85, head: -85, arm: [-75, 280], armF: [-79, 276], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
  ],
  props: () => uprightBench() + floorProp(36, 124),
  hold: { k: 'plate', r: 5 },
};

const C5: ExerciseDemo = {
  id: 'c5',
  view: 'side',
  loopMs: 2400,
  // Crunch: the PELVIS never moves — the spine curls (torso 0 → -30) and the
  // head tucks, which is the difference between a crunch and a sit-up.
  frames: [
    { x: 66, y: 95, torso: 0, head: 0, arm: [-126.7, -164.4], armF: [-121.8, -170.6], leg: [-118.1, 111.8, 120], legF: [-114, 108, 120] },
    { x: 66, y: 95, torso: -30, head: -45, arm: [-128.3, -185.9], armF: [-126.1, -190.8], leg: [-118.1, 111.8, 120], legF: [-114, 108, 120] },
  ],
  props: () => matProp(40, 112, 100) + floorProp(30, 130, 103.4),
  hold: { k: 'plate', r: 5 },
};

const C6: ExerciseDemo = {
  id: 'c6',
  view: 'front',
  loopMs: 3200,
  // Russian twist, three frames: right → centre → left, whose yoyo is the full
  // sweep. The rotation is a shoulder-line ROLL (±25°), i.e. it is led from the
  // ribs — the arms keep the weight in front of the sternum the whole way.
  frames: [
    { x: 80, y: 90, torso: -90, head: -90, arm: [112.7, 32.6], armF: [171.1, 134.3], leg: [-30, 100, -20], legF: [-38, 104, -20], roll: -25 },
    { x: 80, y: 90, torso: -90, head: -90, arm: [154.4, 78.2], armF: [154.4, 78.2], leg: [-30, 100, -20], legF: [-38, 104, -20], roll: 0 },
    { x: 80, y: 90, torso: -90, head: -90, arm: [171.1, 134.3], armF: [112.7, 32.6], leg: [-30, 100, -20], legF: [-38, 104, -20], roll: 25 },
  ],
  props: () => matProp(46, 116, 96),
  hold: { k: 'plate' },
};

/* ---------------------------------------------------------------- library */

const X1: ExerciseDemo = {
  id: 'x1',
  view: 'side',
  loopMs: 2800,
  // Smith squat: the bar is on the shoulders, and because the rail is vertical
  // the shoulder x is the SAME in both frames (78) — the hips travel back and
  // down under it until the thigh is parallel.
  frames: [
    { x: 78, y: 68, torso: -90, head: -90, arm: [120, -100], armF: [124, -104], leg: [61.9, 90, 20], legF: [62, 91.4, 20] },
    { x: 72, y: 84, torso: -75, head: -75, arm: [120, -100], armF: [124, -104], leg: [-2.4, 100.8, 20], legF: [-2.1, 102.2, 20] },
  ],
  props: () => railProp(78, 14, 98) + floorProp(38, 122),
  hold: { k: 'barBack' },
};

const X2: ExerciseDemo = {
  id: 'x2',
  view: 'side',
  loopMs: 2400,
  // Leg extension: the KNEE sits on the machine's pivot and does not move; only
  // the shin rotates, and the roller pad rides the ankle.
  frames: [
    { x: 66, y: 80, torso: -100, head: -100, arm: [95, 95], armF: [92, 92], leg: [0, 90, 0], legF: [-3, 93, 0] },
    { x: 66, y: 80, torso: -100, head: -100, arm: [95, 95], armF: [92, 92], leg: [0, 5, -20], legF: [-3, 8, -20] },
  ],
  props: () =>
    // The station, built from its own parts rather than a bench: a seat that
    // runs under the thighs to the pivot, a backrest set far enough back to
    // read behind the torso, and the pivot itself drawn ON the knee.
    padProp({ x: 46, y: 84 }, { x: 86, y: 84 }) +
    padProp({ x: 60, y: 84 }, { x: 55, y: 58 }) +
    frameProp(48, 84, FLOOR) +
    frameProp(84, 84, FLOOR) +
    frameProp(84, 84, 66) +
    pivotProp(83, 80) +
    floorProp(34, 122),
  hold: { k: 'roller', joint: 'ankle' },
};

const X3: ExerciseDemo = {
  id: 'x3',
  view: 'side',
  loopMs: 2400,
  // Lying leg curl: face down, hips pinned to the pad (the pelvis is identical
  // in both frames) and only the shin curls up against the roller.
  frames: [
    { x: 84, y: 80, torso: 180, head: 180, arm: [160, 175], armF: [163, 178], leg: [0, 0, 30], legF: [3, 3, 30] },
    { x: 84, y: 80, torso: 180, head: 180, arm: [160, 175], armF: [163, 178], leg: [0, -80, -50], legF: [3, -76, -46] },
  ],
  props: () => benchProp({ x: 40, y: 86, len: 66, floorY: FLOOR }) + pivotProp(101, 80) + floorProp(28, 136),
  hold: { k: 'roller', joint: 'ankle' },
};

const X4: ExerciseDemo = {
  id: 'x4',
  view: 'front',
  loopMs: 2200,
  // Lateral raise: the only lift here that MUST be seen from the front — from
  // the side the whole movement happens straight at the camera.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [85, 88], armF: [85, 88], leg: [85, 88, 20], legF: [85, 88, 20] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [-5, 12], armF: [-5, 12], leg: [85, 88, 20], legF: [85, 88, 20] },
  ],
  props: () => floorProp(48, 112),
  hold: { k: 'db' },
};

const X5: ExerciseDemo = {
  id: 'x5',
  view: 'side',
  loopMs: 2200,
  // Rope pushdown: the upper arm is frozen at 95 in both frames — the cue is
  // "only the forearm moves" — and the rope runs to the high pulley.
  frames: [
    { x: 76, y: 66, torso: -85, head: -80, arm: [95, -10], armF: [92, -14], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 76, y: 66, torso: -85, head: -80, arm: [95, 80], armF: [92, 84], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => pulleyProp(100, 18, { stack: true }) + floorProp(44, 122),
  hold: { k: 'rope', from: [100, 18] },
};

const X6: ExerciseDemo = {
  id: 'x6',
  view: 'side',
  loopMs: 2600,
  frames: [
    { x: 66, y: 80, torso: -83, head: -83, arm: [-32.1, -64.6], armF: [-45.7, -45.7], leg: [15, 85, 5], legF: [12, 88, 5] },
    { x: 66, y: 80, torso: -83, head: -83, arm: [105.1, -19.6], armF: [93.2, -21.4], leg: [15, 85, 5], legF: [12, 88, 5] },
  ],
  props: () =>
    pulleyProp(108, 16, { stack: true }) +
    benchProp({ x: 52, y: 84, len: 22, floorY: FLOOR }) +
    padProp({ x: 76, y: 76 }, { x: 90, y: 76 }) +
    floorProp(34, 130),
  hold: { k: 'handle', from: [108, 16] },
};

const X7: ExerciseDemo = {
  id: 'x7',
  view: 'side',
  loopMs: 2400,
  // OUR face pull, and the sagittal plane is the only one that can show it: the
  // rope starts at a pulley set to FACE height with the arms extended, and
  // finishes at the forehead with the elbows driven back and up to shoulder
  // level — high elbows are the whole cue, and from the front they would be
  // pointing straight at the camera.
  frames: [
    { x: 70, y: 66, torso: -90, head: -90, arm: [18, -31.9], armF: [5.3, -12.1], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 70, y: 66, torso: -90, head: -90, arm: [-134.7, -1.5], armF: [-118.3, 14.5], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => pulleyProp(118, 34, { post: 32, stack: true }) + floorProp(40, 132),
  hold: { k: 'rope', from: [118, 34] },
};

const X8: ExerciseDemo = {
  id: 'x8',
  view: 'front',
  loopMs: 2000,
  // Shrug: nothing rotates at all. The shoulder line rises 6 along the spine
  // (`shrug`) and the straight arms — and the dumbbells — ride up with it.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [88, 90], armF: [88, 90], leg: [85, 88, 20], legF: [85, 88, 20], shrug: 0 },
    { x: 80, y: 66, torso: -90, head: -90, arm: [88, 90], armF: [88, 90], leg: [85, 88, 20], legF: [85, 88, 20], shrug: 6 },
  ],
  props: () => floorProp(48, 112),
  hold: { k: 'db' },
};

const X9: ExerciseDemo = {
  id: 'x9',
  view: 'side',
  loopMs: 2200,
  // Hammer curl: the same pinned elbow and the same arc as a5 — because it IS
  // the same arc. What tells them apart is the grip, so the dumbbell is drawn
  // ALONG the forearm (neutral, thumbs up) instead of across it, and it never
  // rotates on the way up. Drawn in the sagittal plane for the same reason a5
  // is: a curl seen from the front happens straight at the camera.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, 90], armF: [88, 90], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, -60], armF: [88, -64], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => floorProp(48, 112),
  hold: { k: 'db', axis: 'along' },
};

const X10: ExerciseDemo = {
  id: 'x10',
  view: 'side',
  loopMs: 2800,
  // Pullover: one dumbbell in both hands travelling a wide ARC from behind the
  // head to over the chest, with the elbow bend held constant throughout.
  frames: [
    { x: 72, y: 78, torso: 0, head: 0, arm: [-58.7, -14.8], armF: [-32.2, -32.2], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
    { x: 72, y: 78, torso: 0, head: 0, arm: [-117.5, -75.7], armF: [-112.6, -69.7], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
  ],
  props: () => flatBench(46, 74) + floorProp(30, 140),
  hold: { k: 'plate', r: 6 },
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
