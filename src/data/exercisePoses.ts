/**
 * data/exercisePoses.ts — one looping demonstration per built-in exercise.
 *
 * A demo is DATA, not media: a view (which plane the camera is on), two to
 * three keyframes of joint angles for `ui/coachFigure.ts`, the props the lift
 * happens on, what the hands are holding, and a rep tempo. Roughly 11 kB of
 * numbers for all 39 exercises — the whole feature ships without a single byte
 * of image, video or font, which is what keeps the single-file build honest.
 *
 * AN EXERCISE CAN HAVE TWO IMPLEMENTATIONS, AND THEN IT SHOWS BOTH. Half the
 * program's names are a choice rather than a movement: "פולי עליון / מתח",
 * "חתירה בסמית׳ / משקולות", "הרמות רגליים בתלייה או בשכיבה", "כפיפות בטן
 * בשיפוע / עם משקל". A demo that silently picks one of them teaches the wrong
 * thing to whoever came for the other, so those six carry a `variants` array and
 * the drawer draws them side by side, each with the tiny Hebrew caption that
 * says which is which, both animated off one clock (`ui/exerciseDemo.ts`). The
 * order is the order the exercise's own Hebrew name lists them in. Everything
 * else has exactly one variant and fills the card on its own.
 *
 * THE KEYFRAMES ARE A YOYO, BUT NOT A SYMMETRIC ONE. `frames` lists the rep in
 * ONE direction (usually start → finish) and `ui/exerciseDemo.ts` plays it there
 * and back with a cosine ease — slow at both ends, quickest through the middle,
 * which is what a controlled rep looks like. What it does NOT do is give the two
 * halves the same time: `forwardShare` says how much of the clock the forward
 * pass gets, because the eccentric is the slow half. A press whose frames run
 * bottom → top asks for less than half; a hinge whose frames run standing →
 * bottom asks for more. Two frames are a press; three are a movement with a
 * meaningful middle (the russian twist: right → centre → left, whose yoyo is the
 * full side-to-side sweep) or a path that a straight lerp would otherwise bow
 * off its line (a guided bar, see below).
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
 * WHICH PLANE THE CAMERA IS ON is a decision per movement, not a habit. Most
 * lifts live in the sagittal plane and are drawn from the side. Six do not: a
 * lateral raise, a shrug, a crossover and a russian twist happen across the
 * body, and so — this is what the review caught — do a FLYE and a FACE PULL.
 * Both are two-sided, and from the side their two hands stack into one no matter
 * how carefully the angles are solved: the flye read as a single dumbbell
 * looping over the chest, the face pull as one fist at one temple. The flye is
 * therefore shot from directly overhead, which for a lifter on his back is the
 * front silhouette, and the face pull square-on.
 *
 * WE ANIMATE OUR OWN COACHING COPY. Where `data/program.ts` teaches a specific
 * variant, the demo follows THAT — a1 is the Smith rail (a fixed vertical bar
 * path) while c1 is the same incline with dumbbells and a deeper stretch; the
 * crunch carries its plate ON THE CHEST because that is the words our own step
 * uses; b2 is drawn as the pull-up its steps describe.
 *
 * A GUIDED PATH GETS A THIRD KEYFRAME. Two poses and a straight lerp do not make
 * a straight line: the segment angles interpolate independently, so between the
 * ends a Smith bar bows off its rail, a press travels an arc and a hanging fist
 * slides along the bar. Where that mattered, the middle keyframe was solved by
 * inverse kinematics ON the line the load should travel — the rail's own x, or
 * the chord between the two ends — and `tests/exercisePoses.test.ts` samples the
 * movement BETWEEN the keyframes to prove it stayed there.
 *
 * A custom exercise (`cx_…`) has no entry here on purpose — see `demoFor`.
 */

import {
  barProp,
  benchDiagProp,
  benchProp,
  dipBarsProp,
  floorProp,
  frameProp,
  matProp,
  padProp,
  pivotProp,
  pulleyProp,
  railProp,
  treadmillProp,
  type Hold,
  type Pose,
  type View,
} from '../ui/coachFigure.ts';

/**
 * ONE WAY OF DOING THE EXERCISE — a plane, a station, a set of keyframes and
 * something in the hands. Most exercises have exactly one; the ones whose own
 * name offers two get two, and the drawer shows them side by side.
 */
export interface DemoVariant {
  /**
   * The tiny Hebrew label under this stage. Present exactly when the exercise
   * has more than one variant: with a single demo the exercise's own name is
   * already the caption, and repeating it would be noise.
   */
  readonly caption?: string;
  readonly view: View;
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
}

export interface ExerciseDemo {
  /** The exercise id this demonstrates (`data/program.ts`). */
  readonly id: string;
  /** One or two ways to do it, in the order the drawer shows them. Never empty. */
  readonly variants: readonly DemoVariant[];
}

/** The common case: an exercise with exactly one implementation. */
const one = (id: string, v: DemoVariant): ExerciseDemo => ({ id, variants: [v] });

/* ------------------------------------------------------------ shared props */

const FLOOR = 102;
const flatBench = (x: number, len: number): string => benchProp({ x, y: 84, len, floorY: FLOOR });
const inclineBench = (): string => benchProp({ x: 66, y: 84, len: 46, angle: -30, seat: 16, floorY: FLOOR });
const uprightBench = (): string => benchProp({ x: 68, y: 84, len: 34, angle: -85, seat: 16, floorY: FLOOR });

/**
 * A DECLINE SIT-UP BENCH: the pad tipped 12° so the head end is the low one,
 * with the ankle bracket at the top of the slope where the feet hook under.
 */
const declineBench = (): string =>
  padProp({ x: 54, y: 84 }, { x: 112, y: 96.3 }) +
  padProp({ x: 54, y: 73 }, { x: 66, y: 75.5 }) +
  frameProp(56, 84, FLOOR) +
  frameProp(56, 84, 73) +
  frameProp(109, 96, FLOOR) +
  floorProp(30, 132);

/**
 * A LAT-PULLDOWN STATION seen from the side: the seat, and the thigh pad on its
 * post that stops the whole lifter being pulled up off it.
 */
const pulldownStation = (): string =>
  benchProp({ x: 46, y: 86, len: 22, floorY: FLOOR }) +
  padProp({ x: 75, y: 78.5 }, { x: 97, y: 80.5 }) +
  frameProp(96, 80, 90);

/**
 * a4 lies along a diagonal — spine at -15°, head up and to the right, feet down
 * and to the left — with the shoulder line rolled perpendicular to it. The head
 * is at the far end on purpose: the arms work on the FOOT side of it, so nothing
 * either arm does can tangle with the skull. Everything below the waist is
 * frozen; this lift happens above it.
 */
const A4_BASE = {
  x: 68, y: 74, torso: -15, head: -15, roll: 105,
  leg: [162, 125, 92], legF: [18, 55, 88],
} as const;

/* ------------------------------------------------------------------ day A */

/**
 * a1 · INCLINE PRESS, WHICH OUR OWN NAME OFFERS TWO WAYS: `Incline Smith /
 * Dumbbell Press`. So the drawer shows both, side by side — the rail version
 * first, because that is the one the steps describe the bar path of, and the
 * dumbbells beside it. They share the bench, the recline and the frozen legs;
 * what differs is what the hands are on and therefore how deep the bottom is.
 */
const A1_BASE = { x: 68, y: 81, torso: -30, head: -30, leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] } as const;

const A1: ExerciseDemo = {
  id: 'a1',
  variants: [{
  caption: 'סמית׳',
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.42,
  // Smith incline press: the bar CANNOT leave the rail, so every keyframe puts
  // the hands on x=84 and only the height changes — bar at the upper chest,
  // then pressed to just short of lockout. The MIDDLE keyframe is there because
  // two are not enough to say that: the two arm angles lerp independently, and
  // between the ends they bowed the bar 3.8 units off the track, which is the
  // one thing a guided bar cannot do. It is solved by IK from the grip on the
  // rail, and it brings the bow down to 1.1.
  frames: [
    { x: 68, y: 81, torso: -30, head: -30, arm: [-210.9, -64], armF: [-198.6, -46.8], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
    { x: 68, y: 81, torso: -30, head: -30, arm: [-163.6, -58.2], armF: [-156.7, -48.8], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
    { x: 68, y: 81, torso: -30, head: -30, arm: [-120.5, -82.4], armF: [-117.1, -75.2], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
  ],
  props: () => inclineBench() + railProp(84, 28, 92) + floorProp(30, 140),
  hold: { k: 'bar' },
  }, {
    caption: 'משקולות',
    view: 'side',
    loopMs: 2600,
    forwardShare: 0.42,
    // The same bench without the rail: nothing guides the path, so the bottom is
    // a little deeper and a little wider than the bar's. Still a press and not a
    // swing — the middle keyframe is solved on the chord between the ends.
    frames: [
      { ...A1_BASE, arm: [-208.1, -82.1], armF: [-204.7, -70.9] },
      { ...A1_BASE, arm: [-175.4, -83.8], armF: [-173.2, -74.2] },
      { ...A1_BASE, arm: [-138.5, -103.7], armF: [-140.9, -92.6] },
    ],
    props: () => inclineBench() + floorProp(30, 140),
    hold: { k: 'db' },
  }],
};

const A2: ExerciseDemo = one('a2', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.44,
  // One-arm row: the FAR side is the support (knee and hand on the bench) and
  // never moves; only the near arm rows the dumbbell to the hip pocket.
  frames: [
    { x: 100, y: 68, torso: 182, head: 182, arm: [83.5, 95.7], armF: [82.8, 167.2], leg: [62.7, 96.5, 25], legF: [98, 0, 65] },
    { x: 100, y: 68, torso: 182, head: 182, arm: [-32.2, 64.9], armF: [82.8, 167.2], leg: [62.7, 96.5, 25], legF: [98, 0, 65] },
  ],
  props: () => flatBench(48, 76) + floorProp(30, 140),
  hold: { k: 'dbNear' },
});

const A3: ExerciseDemo = one('a3', {
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.58,
  // Split squat: the feet are planted in both frames, the pelvis drops 12 and
  // the front thigh arrives parallel with the shin vertical.
  frames: [
    { x: 72, y: 71, torso: -87, head: -87, arm: [90, 90], armF: [92, 90], leg: [44.9, 90.1, 25], legF: [89.7, 141.3, 45] },
    { x: 66, y: 83, torso: -87, head: -87, arm: [90, 90], armF: [92, 90], leg: [0.1, 86.4, 25], legF: [55.7, 176.6, 45] },
  ],
  props: () => floorProp(36, 120),
  hold: { k: 'db' },
});

const A4: ExerciseDemo = one('a4', {
  view: 'threeQuarter',
  loopMs: 3000,
  forwardShare: 0.45,
  // FLYE, AT THREE QUARTERS — the angle every exercise book has drawn this lift
  // from, and for the same reason we ended up here.
  //
  // A flye is BILATERAL: the arms open to both sides of the body and close in
  // front of the chest. The sagittal camera cannot say that — from the side the
  // two arms stack into one plane and the pair reads as a single dumbbell
  // looping over the chest. The overhead camera says it, but says nothing else:
  // a body seen from straight above is a rectangle with a head on it, and the
  // review's verdict on that was "looks terrible". The three-quarter view is the
  // one that gives both: the bench runs away from the viewer on a diagonal, the
  // body lies along it, and the shoulders spread on the SAME diagonal — so the
  // near arm swings down towards the viewer and the far arm up away from it,
  // and they are two arms with a depth order rather than two arms side by side.
  //
  // `roll: 105` is what turns the body onto that diagonal: the shoulder line is
  // held perpendicular to a spine that lies at 195°, which is the difference
  // between a lifter on a bench and a lifter standing up in the picture plane.
  //
  // THE ELBOWS STAY PARKED. The far one barely moves at all (y ≈ 50 the whole
  // way) and the near one travels along under the bench edge; neither ever
  // straightens and neither ever folds shut — the elbow angle lives between 47°
  // and 112° across the whole rep, which is "hug a wide tree" rather than
  // "press". The dumbbells go from 62 units apart to 2, and only ever converge.
  //
  // AND BOTH ELBOWS BOW THE SAME ANATOMICAL WAY, which is the one thing the
  // rig's automatic mirror cannot be trusted with here. That mirror reflects the
  // far side about the PICTURE's vertical axis — right for a lifter standing
  // square to the camera, wrong for one lying along a diagonal, whose sagittal
  // plane projects to a nearly HORIZONTAL line. Reflecting about the wrong axis
  // flipped the elbow's BEND along with its position: the far elbow kinked
  // towards the head while the near one kinked towards the feet, and the far arm
  // read as bent backwards. So the far arm's two segment angles are authored
  // EXPLICITLY here, taken from the other inverse-kinematic branch — the far
  // hand is exactly where it was, and only the elbow moved to the other side of
  // it.
  //
  // What says it is right is the FK rather than the eye: the elbow sits on
  // OPPOSITE sides of its own shoulder→hand line for the two arms, in every
  // frame, which is what a mirrored pair looks like when one of them travels the
  // other way across the picture.
  frames: [
    { ...A4_BASE, arm: [67.3, 125.2], armF: [228.4, 275.5] },
    { ...A4_BASE, arm: [177.4, 269.1], armF: [287.1, 398.9] },
  ],
  // the bench is a parallelogram on the same diagonal, head end up and to the
  // right, so the body lies along it and the legs run off the foot end
  props: () =>
    benchDiagProp({ a: { x: 108, y: 63.5 }, b: { x: 48, y: 79 }, dep: { x: 0, y: 9.5 } }) +
    floorProp(28, 132),
  hold: { k: 'db' },
});

const A5: ExerciseDemo = one('a5', {
  view: 'side',
  loopMs: 2200,
  forwardShare: 0.42,
  // Curl: the upper arm is IDENTICAL in both frames (elbow pinned to the ribs)
  // and only the forearm rotates. Zero body sway — the pelvis never moves.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, 90], armF: [88, 90], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [92, -60], armF: [88, -64], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => floorProp(48, 112),
  hold: { k: 'db' },
});

const A6: ExerciseDemo = {
  id: 'a6',
  variants: [{
  caption: 'בתלייה',
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.45,
  // Hanging knee raise: the hands stay on the bar in both frames, the knees
  // come to the chest and the pelvis tilts up (torso -90 → -100) at the top.
  frames: [
    { x: 83, y: 63, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [92, 90, 25], legF: [88, 92, 25] },
    { x: 83, y: 61, torso: -100, head: -45, arm: [-100, -65.2], armF: [-90.7, -63.5], leg: [-32.7, 60, 10], legF: [-28, 64, 10] },
  ],
  props: () => barProp(60, 106, 10, 6),
  hold: { k: 'none' },
  }, {
    caption: 'בשכיבה',
    view: 'side',
    loopMs: 2800,
    forwardShare: 0.45,
    // LYING, the other half of 'הרמות רגליים/ברכיים בתלייה או בשכיבה'. On a
    // bench the hands grip the pad beside the hips instead of a bar overhead —
    // elbows folded up over the ribs, which is both what a lifter does and the
    // one place an arm does not cross the skull in this projection. The legs run
    // off the end of the pad, and the raise is the same hip flexion taken to
    // vertical: knee all but straight, so the shins finish over the hips.
    frames: [
      { x: 70, y: 75, torso: 0, head: 0, arm: [-148.5, 114.7], armF: [-145, 118], leg: [178, 179, 200], legF: [175, 182, 200] },
      { x: 70, y: 75, torso: 0, head: 0, arm: [-148.5, 114.7], armF: [-145, 118], leg: [258, 264, 280], legF: [255, 267, 280] },
    ],
    props: () => benchProp({ x: 66, y: 80, len: 58, floorY: FLOOR }) + floorProp(24, 140),
    hold: { k: 'none' },
  }],
};

/* ------------------------------------------------------------------ day B */

/**
 * b1's press path, shared with x12: the three keyframes were solved so the
 * hands travel the vertical line x=92 — for b1 that line is the Smith rail, and
 * for the dumbbell press it is simply what a press looks like (straight up,
 * not an arc), so the same solution serves both.
 */
const FLAT_PRESS_FRAMES: readonly Pose[] = [
  { x: 74, y: 78, torso: 0, head: 0, arm: [-214.4, -70.6], armF: [-205.2, -55.3], leg: [166.4, 88.1, 155], legF: [166.4, 89.6, 155] },
  { x: 74, y: 78, torso: 0, head: 0, arm: [-166.2, -62.8], armF: [-139, -63.9], leg: [166.4, 88.1, 155], legF: [166.4, 89.6, 155] },
  { x: 74, y: 78, torso: 0, head: 0, arm: [-121.3, -86.2], armF: [-118.9, -78.4], leg: [166.4, 88.1, 155], legF: [166.4, 89.6, 155] },
];

const B1: ExerciseDemo = one('b1', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.42,
  // Flat Smith bench: same story as a1 — the bar cannot leave x=92, and the
  // middle keyframe is what stops a straight lerp bowing it four units off.
  frames: FLAT_PRESS_FRAMES,
  props: () => flatBench(44, 74) + railProp(92, 24, 92) + floorProp(28, 140),
  hold: { k: 'bar' },
});

/**
 * b2 · פולי עליון / מתח — the exercise is literally named after its two
 * implementations, and the machine is named FIRST, so the drawer leads with the
 * seated pulldown and puts the pull-up beside it. They are the same movement
 * from opposite ends: on the machine the bar travels to a body that stays put,
 * on the bar the body travels to a grip that stays put.
 */
const B2_SEAT = { x: 64, y: 80, torso: -83, head: -83, leg: [15, 85, 5] as const, legF: [12, 88, 5] as const };

/**
 * b2's two movements, shared with the library: the same pulldown serves x19
 * (only the grip on the drawn bar differs) and the same pull-up path serves the
 * assisted (x14) and negative (x17) pull-ups — they ARE this movement, done
 * with help on the way up or fought on the way down.
 */
const PULLDOWN_FRAMES: readonly Pose[] = [
  { ...B2_SEAT, arm: [-79.3, -56.4], armF: [-78.7, -56.6] },
  { ...B2_SEAT, arm: [4.5, -106.5], armF: [4.7, -106.1] },
  { ...B2_SEAT, arm: [90, -44.7], armF: [90.2, -44.4] },
];

const pulldownProps = (): string =>
  pulldownStation() + pulleyProp(78, 14, { top: 8, post: 72, postX: 108 }) + floorProp(34, 132);

const PULLUP_FRAMES: readonly Pose[] = [
  { x: 84, y: 65, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [95, 85, 30], legF: [100, 80, 30] },
  { x: 85, y: 56.5, torso: -93.5, head: -75, arm: [-39.7, -129.8], armF: [-32.9, -122.3], leg: [97.5, 77.5, 30], legF: [102.5, 72.5, 30] },
  { x: 86, y: 48, torso: -97, head: -100, arm: [-11.7, -142.5], armF: [-1.3, -130], leg: [100, 70, 30], legF: [105, 65, 30] },
];

const B2: ExerciseDemo = {
  id: 'b2',
  variants: [{
  caption: 'פולי עליון',
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.44,
  // LAT PULLDOWN. Seated with the thighs under the pad, a wide bar on the cable,
  // and the bar travelling STRAIGHT DOWN the line the pulley hangs on — x=78 in
  // all three keyframes — from overhead to the upper chest. The middle keyframe
  // is what makes that true between them: solved for the least bow rather than
  // for a point, it takes the path from 12 units off the vertical to 2. The
  // elbow leads: it starts above the shoulder, swings forward through shoulder
  // height and finishes down at the ribs, which is the cue our steps give.
  frames: PULLDOWN_FRAMES,
  props: pulldownProps,
  hold: { k: 'handle', from: [78, 14], wide: true },
  }, {
  caption: 'מתח',
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.44,
  // Pull-up: the grip is fixed on the bar and the BODY travels — the pelvis
  // rises 17 and the chin arrives level with the bar, with the head tipping back
  // rather than straight up (a skull drawn right under the fists hides them, and
  // looking up is what the movement asks for anyway). The MIDDLE keyframe is
  // solved from the grip: with two frames the fists slid four units along the
  // bar half way up, and a hand that slides is not a hand that is holding on.
  frames: PULLUP_FRAMES,
  props: () => barProp(58, 110, 12, 6),
  hold: { k: 'none' },
  }],
};

const B3: ExerciseDemo = one('b3', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.58,
  // Dip: hands fixed on the bars, torso held at the ~30° forward lean the steps
  // ask for, body descends 15 to a right angle at the elbow.
  //
  // THE LEGS GO BACK, NOT FORWARD. This lift leans over its own hands, so the
  // shins have to tuck BEHIND the body to keep the whole thing balanced — knee
  // bent to a right angle and pointing down and forward, shin swept back, feet
  // crossed-ish behind, which is what everyone actually does on the bars. The
  // first pass had them hanging forward like a seated knee raise, which reads as
  // a man about to fall off backwards. What pins it now is the FK rather than
  // the eye: the toe sits 20 units BEHIND the knee, and this figure faces +x.
  frames: [
    { x: 74, y: 47, torso: -60, head: -60, arm: [119.3, 64.7], armF: [113, 59.5], leg: [60, 150, 172], legF: [68, 142, 166] },
    { x: 74, y: 62, torso: -58, head: -58, arm: [173.8, 35], armF: [159, 20.8], leg: [60, 150, 172], legF: [68, 142, 166] },
  ],
  props: () => dipBarsProp(62, 104, 52, FLOOR),
  hold: { k: 'none' },
});

const B4_HINGE = { x: 76, y: 66, torso: -45, head: -45, leg: [85.2, 109.8, 25] as const, legF: [86.4, 110, 25] as const };

const B4: ExerciseDemo = {
  id: 'b4',
  variants: [{
  caption: 'סמית׳',
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.44,
  // Bent-over row in the Smith: the torso is hinged to 45° and stays there —
  // no body english — and the bar runs up the rail to the lower chest.
  frames: [
    { x: 76, y: 66, torso: -45, head: -45, arm: [92.7, 87.5], armF: [84.8, 84.8], leg: [85.2, 109.8, 25], legF: [86.4, 110, 25] },
    { x: 76, y: 66, torso: -45, head: -45, arm: [161.5, 34.1], armF: [149.4, 23.2], leg: [85.2, 109.8, 25], legF: [86.4, 110, 25] },
  ],
  props: () => railProp(93, 26, 94) + floorProp(40, 124),
  hold: { k: 'bar' },
  }, {
    caption: 'משקולות',
    view: 'side',
    loopMs: 2600,
    forwardShare: 0.44,
    // The free version of the same hinge: no rail, so the dumbbells hang
    // straight down from the shoulders and are rowed back to the hips with the
    // elbow driving past the ribs. Same 45° torso, and it still does not move.
    frames: [
      { ...B4_HINGE, arm: [90, 90], armF: [92, 92] },
      { ...B4_HINGE, arm: [191.3, 66.4], armF: [187, 70] },
    ],
    props: () => floorProp(40, 124),
    hold: { k: 'db' },
  }],
};

const B5: ExerciseDemo = one('b5', {
  view: 'side',
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
  props: () => matProp(38, 122, 100) + floorProp(30, 140, 103.4),
  hold: { k: 'none' },
});

const B6: ExerciseDemo = one('b6', {
  view: 'front',
  loopMs: 2800,
  forwardShare: 0.44,
  // Crossover, seen from the front so the arc is visible: high and wide, then
  // the hands meet in front of the belly. Both cables come from their own high
  // pulley and follow the hands.
  frames: [
    { x: 80, y: 68, torso: -90, head: -90, arm: [18.3, -23.8], armF: [18.3, -23.8], leg: [85, 88, 20], legF: [85, 88, 20] },
    { x: 80, y: 68, torso: -90, head: -90, arm: [99.5, 99.5], armF: [99.5, 99.5], leg: [85, 88, 20], legF: [85, 88, 20] },
  ],
  props: () => pulleyProp(24, 26, { stack: true }) + pulleyProp(136, 26, { stack: true }) + floorProp(36, 124),
  hold: { k: 'cables', from: [[24, 26], [136, 26]] },
});

/* ------------------------------------------------------------------ day C */

const C1: ExerciseDemo = one('c1', {
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.4,
  // The same 30° incline as a1, but with dumbbells: no rail, so the path is
  // perpendicular to the torso and the bottom is DEEPER than the bar allows.
  // A free press is not guided, but it is still a PRESS and not a swing: the
  // middle keyframe is solved on the chord between the two ends, which takes the
  // bow from 2.8 units down to 0.9 and stops the demo reading as a circle.
  frames: [
    { x: 68, y: 81, torso: -30, head: -30, arm: [-208.1, -82.1], armF: [-204.7, -70.9], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
    { x: 68, y: 81, torso: -30, head: -30, arm: [-175.4, -83.8], armF: [-173.2, -74.2], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
    { x: 68, y: 81, torso: -30, head: -30, arm: [-138.5, -103.7], armF: [-140.9, -92.6], leg: [175, 75.8, 155], legF: [175.3, 77.2, 155] },
  ],
  props: () => inclineBench() + floorProp(30, 140),
  hold: { k: 'db' },
});

const C2: ExerciseDemo = {
  id: 'c2',
  variants: [{
  caption: 'משקולות',
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.6,
  // RDL: the hips travel BACK 14 while the knee keeps its small fixed bend and
  // the arms simply hang, so the dumbbells track down the shins by themselves.
  frames: [
    { x: 62, y: 66, torso: -90, head: -90, arm: [90, 90], armF: [92, 90], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 48, y: 70, torso: -15, head: -25, arm: [90, 90], armF: [92, 90], leg: [51.8, 77.8, 25], legF: [51.8, 77.8, 25] },
  ],
  props: () => floorProp(34, 118),
  hold: { k: 'db' },
  }, {
    caption: 'סמית׳',
    view: 'side',
    loopMs: 3000,
    forwardShare: 0.6,
    // THE SMITH RDL IS A DIFFERENT PICTURE, not the same one with a bar drawn
    // in. The rail is vertical, so the bar cannot follow the shins: it goes
    // straight down x=88 while the hips travel back away from it, and the arms
    // are what take up the difference. Every keyframe's arms are solved by IK
    // from the grip ON the rail, which is why the bar stays within one unit of
    // it the whole way rather than only at the ends. Three keyframes, because
    // the planted ankle needs a middle one as much as the bar does.
    frames: [
      { x: 80, y: 65.8, torso: -90, head: -90, arm: [93.6, 55.2], armF: [93.6, 55.2], leg: [81.3, 99.3, 4], legF: [82.8, 97.8, 4] },
      { x: 72, y: 67.5, torso: -55, head: -58, arm: [99.5, 73.3], armF: [99.5, 73.3], leg: [61.1, 90.8, 4], legF: [62.6, 89.3, 4] },
      { x: 62, y: 71.5, torso: -20, head: -28, arm: [106.1, 62.4], armF: [106.1, 62.4], leg: [45.6, 67.5, 4], legF: [47.1, 66, 4] },
    ],
    props: () => railProp(88, 18, 98) + floorProp(34, 122),
    hold: { k: 'bar' },
  }],
};

const C3: ExerciseDemo = one('c3', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.42,
  // Seated shoulder press: from ear height to overhead, spine on the backrest —
  // and STRAIGHT UP, which two keyframes could not promise. The middle one is
  // solved on the chord and takes the bow from 3.9 units to 1.
  frames: [
    { x: 74, y: 80, torso: -80, head: -80, arm: [26.2, -98.4], armF: [27, -88.5], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
    { x: 74, y: 80, torso: -80, head: -80, arm: [-17.6, -112.9], armF: [-14.2, -103.6], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
    { x: 74, y: 80, torso: -80, head: -80, arm: [-63.1, -98.5], armF: [-61.5, -90], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
  ],
  props: () => uprightBench() + floorProp(36, 124),
  hold: { k: 'db' },
});

const C4: ExerciseDemo = one('c4', {
  view: 'side',
  loopMs: 2400,
  forwardShare: 0.42,
  // Overhead extension: the upper arm is frozen at -75 in BOTH frames (elbows
  // stay tucked and pointing forward) and only the forearm swings behind the
  // head and back up. One dumbbell in both hands, so it rides the midpoint.
  frames: [
    { x: 74, y: 80, torso: -85, head: -85, arm: [-75, 150], armF: [-79, 154], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
    { x: 74, y: 80, torso: -85, head: -85, arm: [-75, 280], armF: [-79, 276], leg: [13.3, 88.4, 15], legF: [13.3, 89.8, 15] },
  ],
  props: () => uprightBench() + floorProp(36, 124),
  hold: { k: 'plate', r: 5 },
});

const C5: ExerciseDemo = {
  id: 'c5',
  variants: [{
  caption: 'על מזרן',
  view: 'side',
  loopMs: 2400,
  forwardShare: 0.44,
  // Crunch: the PELVIS never moves — the spine curls (torso 0 → -30) and the
  // head tucks, which is the difference between a crunch and a sit-up.
  //
  // AND THE PLATE SITS ON THE CHEST. Our own step says so — 'משקל קל על החזה' —
  // but the first pass held it out at arm's length past the knees, which is a
  // different exercise and a harder one. Both keyframes now fold the arm: the
  // elbows are solved OUT and up, clear of the skull, and the forearms cross
  // back so the two fists meet over the sternum. The plate is the midpoint of
  // those fists, so it cannot help but ride the torso through the curl — 7 units
  // off the chest line, between the shoulders and the hips, in both frames.
  frames: [
    { x: 66, y: 95, torso: 0, head: 0, arm: [-59.9, 162.4], armF: [-59.9, 162.4], leg: [-118.1, 111.8, 120], legF: [-114, 108, 120] },
    { x: 66, y: 95, torso: -30, head: -45, arm: [-89.9, 132.4], armF: [-89.9, 132.4], leg: [-118.1, 111.8, 120], legF: [-114, 108, 120] },
  ],
  props: () => matProp(40, 112, 100) + floorProp(30, 130, 103.4),
  hold: { k: 'plate', r: 5 },
  }, {
    caption: 'בשיפוע',
    view: 'side',
    loopMs: 2400,
    forwardShare: 0.44,
    // The decline bench our step names first ('ספסל בשיפוע שלילי או מזרן'): the
    // feet are hooked at the HIGH end, the head is the low one, and the whole
    // body — and the plate on its chest — is the mat version tipped 12°. The
    // plate is solved the same way, perpendicular to the spine, so it rides the
    // sternum on the slope exactly as it does on the floor.
    frames: [
      { x: 73, y: 81.5, torso: 12, head: 12, arm: [-47.9, 174.4], armF: [-47.9, 174.4], leg: [-106.1, 123.8, 132], legF: [-102, 120, 132] },
      { x: 73, y: 81.5, torso: -18, head: -33, arm: [-77.9, 144.4], armF: [-77.9, 144.4], leg: [-106.1, 123.8, 132], legF: [-102, 120, 132] },
    ],
    props: () => declineBench(),
    hold: { k: 'plate', r: 5 },
  }],
};

const C6: ExerciseDemo = one('c6', {
  view: 'front',
  loopMs: 3200,
  forwardShare: 0.5,
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
});

/**
 * x7 stands square on its feet and is TURNED, not rotated: the pose is a plain
 * standing one and the three-quarter view does the turning.
 */
const X7_BASE = {
  x: 70, y: 66, torso: -90, head: -90,
  leg: [86, 89, 20], legF: [86, 89, 20],
} as const;

/* ---------------------------------------------------------------- library */

const X1: ExerciseDemo = one('x1', {
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.58,
  // Smith squat: the bar is on the shoulders, and because the rail is vertical
  // the shoulder x is the SAME in both frames (78) — the hips travel back and
  // down under it until the thigh is parallel.
  // The middle frame is solved from the same planted ankle as the other two,
  // which is what keeps the shoe still through the descent instead of letting a
  // straight lerp drag it — and keeps the loaded shoulder on the rail the whole
  // way down rather than only at the ends.
  frames: [
    { x: 78, y: 68, torso: -90, head: -90, arm: [120, -100], armF: [124, -104], leg: [61.9, 90, 20], legF: [62, 91.4, 20] },
    { x: 74.7, y: 76, torso: -82, head: -82, arm: [120, -100], armF: [124, -104], leg: [26.2, 104.3, 20], legF: [26.4, 105.7, 20] },
    { x: 72, y: 84, torso: -75, head: -75, arm: [120, -100], armF: [124, -104], leg: [-2.4, 100.8, 20], legF: [-2.1, 102.2, 20] },
  ],
  props: () => railProp(78, 14, 98) + floorProp(38, 122),
  hold: { k: 'barBack' },
});

const X2: ExerciseDemo = one('x2', {
  view: 'side',
  loopMs: 2400,
  forwardShare: 0.42,
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
});

const X3: ExerciseDemo = one('x3', {
  view: 'side',
  loopMs: 2400,
  forwardShare: 0.42,
  // Lying leg curl: face down, hips pinned to the pad (the pelvis is identical
  // in both frames) and only the shin curls up against the roller.
  frames: [
    { x: 84, y: 80, torso: 180, head: 180, arm: [160, 175], armF: [163, 178], leg: [0, 0, 30], legF: [3, 3, 30] },
    { x: 84, y: 80, torso: 180, head: 180, arm: [160, 175], armF: [163, 178], leg: [0, -80, -50], legF: [3, -76, -46] },
  ],
  props: () => benchProp({ x: 40, y: 86, len: 66, floorY: FLOOR }) + pivotProp(101, 80) + floorProp(28, 136),
  hold: { k: 'roller', joint: 'ankle' },
});

const X4: ExerciseDemo = one('x4', {
  view: 'front',
  loopMs: 2200,
  forwardShare: 0.42,
  // Lateral raise: the only lift here that MUST be seen from the front — from
  // the side the whole movement happens straight at the camera.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [85, 88], armF: [85, 88], leg: [85, 88, 20], legF: [85, 88, 20] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [-5, 12], armF: [-5, 12], leg: [85, 88, 20], legF: [85, 88, 20] },
  ],
  props: () => floorProp(48, 112),
  hold: { k: 'db' },
});

const X5: ExerciseDemo = one('x5', {
  view: 'side',
  loopMs: 2200,
  forwardShare: 0.42,
  // Rope pushdown: the upper arm is frozen at 95 in both frames — the cue is
  // "only the forearm moves" — and the rope runs to the high pulley.
  frames: [
    { x: 76, y: 66, torso: -85, head: -80, arm: [95, -10], armF: [92, -14], leg: [92, 88, 25], legF: [88, 92, 25] },
    { x: 76, y: 66, torso: -85, head: -80, arm: [95, 80], armF: [92, 84], leg: [92, 88, 25], legF: [88, 92, 25] },
  ],
  props: () => pulleyProp(100, 18, { stack: true }) + floorProp(44, 122),
  hold: { k: 'rope', from: [100, 18] },
});

const X6: ExerciseDemo = one('x6', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.44,
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
});

const X7: ExerciseDemo = one('x7', {
  view: 'threeQuarter',
  loopMs: 2600,
  forwardShare: 0.44,
  // FACE PULL, AT THREE QUARTERS. A rope has two ends and they arrive at two
  // temples, so the question was only ever which camera can show that.
  //
  // The side view cannot: it stacks both fists on one side of the head no matter
  // what the angles say. The front view can, but it costs everything else — with
  // the lifter square to the camera the cable has to come from directly
  // overhead, the arms work straight at the lens, and the review's verdict was
  // that the rope and the arm read as piercing the skull. The three-quarter view
  // keeps the station where a face pull's station actually is — off to one side
  // at head height, cable running in almost horizontally — and still separates
  // the hands: the near fist finishes beside the near temple and the far one is
  // pushed further out along the depth diagonal, with the head between them.
  //
  // WHAT THE NUMBERS GUARANTEE, over the whole rep and not just at the ends:
  // nothing PAINTED IN FRONT of the body comes within 8 units of the head's
  // centre — not the near arm, not the cable, not the clip, not the near rope
  // end — and the skull's radius is 6.5. The far rope end and the far arm do
  // cross that circle, and they are drawn BEHIND the figure, which is where a
  // rope end pulled past the far ear and a far arm actually are.
  //
  // Elbows wide and high is the cue and both show it: at the finish the near
  // elbow sits 2.7 above its own shoulder and 13 outboard of it, the far one 5.1
  // above and 10 outboard.
  //
  // The fists finish either side of a skull that spans 63.5 to 76.5, at eye
  // level, offset on the depth diagonal so which is which is never in doubt.
  //
  // AND NEITHER ELBOW SNAPS THROUGH. The flye's defect had a quieter cousin
  // here: the far arm reached the rope bowed one way and finished bowed the
  // OTHER, which means that four tenths of the way up it passed through dead
  // straight and flipped — a hinge bending backwards for one frame. Only the far
  // arm's extended keyframe had to move, and only its elbow: the same hand, on
  // the other inverse-kinematic branch, so the bend now holds one direction for
  // the whole rep and never comes inside 43° of straight.
  frames: [
    { ...X7_BASE, arm: [4.4, -25.8], armF: [214.5, 174.8] },
    { ...X7_BASE, arm: [-11.5, -129.3], armF: [333.8, 238.5] },
  ],
  // the station is where a face pull's station is: off to one side, wheel at
  // FACE height, cable coming in almost level
  props: () => pulleyProp(124, 30, { top: 8, post: 34, stack: true }) + floorProp(38, 134),
  hold: { k: 'rope', from: [124, 30] },
});

const X8: ExerciseDemo = one('x8', {
  view: 'front',
  loopMs: 2000,
  forwardShare: 0.45,
  // Shrug: nothing rotates at all. The shoulder line rises 6 along the spine
  // (`shrug`) and the straight arms — and the dumbbells — ride up with it.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [88, 90], armF: [88, 90], leg: [85, 88, 20], legF: [85, 88, 20], shrug: 0 },
    { x: 80, y: 66, torso: -90, head: -90, arm: [88, 90], armF: [88, 90], leg: [85, 88, 20], legF: [85, 88, 20], shrug: 6 },
  ],
  props: () => floorProp(48, 112),
  hold: { k: 'db' },
});

const X9: ExerciseDemo = one('x9', {
  view: 'side',
  loopMs: 2200,
  forwardShare: 0.42,
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
});

const X10: ExerciseDemo = one('x10', {
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.42,
  // Pullover: one dumbbell in both hands travelling a wide ARC from behind the
  // head to over the chest, with the elbow bend held constant throughout.
  frames: [
    { x: 72, y: 78, torso: 0, head: 0, arm: [-58.7, -14.8], armF: [-32.2, -32.2], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
    { x: 72, y: 78, torso: 0, head: 0, arm: [-117.5, -75.7], armF: [-112.6, -69.7], leg: [165.7, 81.1, 155], legF: [165.9, 82.5, 155] },
  ],
  props: () => flatBench(46, 74) + floorProp(30, 140),
  hold: { k: 'plate', r: 6 },
});

const X11: ExerciseDemo = one('x11', {
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.58,
  // GOBLET SQUAT: exactly x1's squat — the same three keyframes of legs, torso
  // and root, with the ankle-solved middle frame that keeps the shoe planted —
  // but nothing on the shoulders and no rail. Instead the weight is ONE bell
  // held at the chest: the elbows are folded down in front of the ribs and the
  // fists meet in front of the upper sternum, so the plate (the midpoint of the
  // two grips) rides the chest through the whole descent. The arm angles turn
  // with the torso's own lean, which is what keeps the bell the same fist's
  // reach off the sternum in all three frames.
  frames: [
    { x: 78, y: 68, torso: -90, head: -90, arm: [112.9, -27.5], armF: [114.9, -25.5], leg: [61.9, 90, 20], legF: [62, 91.4, 20] },
    { x: 74.7, y: 76, torso: -82, head: -82, arm: [120.9, -19.5], armF: [122.9, -17.5], leg: [26.2, 104.3, 20], legF: [26.4, 105.7, 20] },
    { x: 72, y: 84, torso: -75, head: -75, arm: [127.9, -12.5], armF: [129.9, -10.5], leg: [-2.4, 100.8, 20], legF: [-2.1, 102.2, 20] },
  ],
  props: () => floorProp(38, 122),
  hold: { k: 'plate', r: 5 },
});

const X12: ExerciseDemo = one('x12', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.42,
  // Flat DUMBBELL press: b1's bench and b1's solved straight-up path — the
  // three keyframes kept the hands on one vertical line for the Smith rail, and
  // a free press wants exactly that line — with the rail gone and a bell in
  // each hand instead of the bar.
  frames: FLAT_PRESS_FRAMES,
  props: () => flatBench(44, 74) + floorProp(28, 140),
  hold: { k: 'db' },
});

const X13: ExerciseDemo = one('x13', {
  view: 'side',
  loopMs: 4600,
  forwardShare: 0.5,
  // DEAD HANG — a hold, like the plank: it breathes rather than reps. What
  // breathes here is the DECOMPRESSION itself: the shoulders shrug up to the
  // ears (+4 along the spine) while the root drops the same 4, so the fists
  // stay welded to the bar, the shoulder point never moves, and everything
  // below it — pelvis, knees, the skull settling between the shoulders — sinks
  // as the spine lets go. That trade is the whole exercise.
  frames: [
    { x: 83, y: 63, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [92, 90, 25], legF: [88, 92, 25], shrug: 0 },
    { x: 83, y: 67, torso: -90, head: -50, arm: [-90, -90], armF: [-84.9, -84.9], leg: [92, 90, 25], legF: [88, 92, 25], shrug: 4 },
  ],
  props: () => barProp(60, 106, 10, 6),
  hold: { k: 'none' },
});

const X14: ExerciseDemo = one('x14', {
  view: 'side',
  loopMs: 3400,
  forwardShare: 0.5,
  // ASSISTED pull-up: the movement IS b2's pull-up — same grip welded to the
  // bar, same body travelling to it — because that is exactly what the band or
  // the Gravitron teaches. What the assistance buys is the TEMPO: slow and
  // controlled in both directions, which is what the steps prescribe, so the
  // loop is longer and split evenly instead of favouring one direction. The
  // band itself is not drawn: it stretches with the body, and a prop is static
  // for the whole loop — a frozen band would be a lie pinned to the picture.
  frames: PULLUP_FRAMES,
  props: () => barProp(58, 110, 12, 6),
  hold: { k: 'none' },
});

const X15: ExerciseDemo = one('x15', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.44,
  // SEATED CABLE ROW: a low-pulley station built from its own parts — the seat,
  // the footplate the shoes brace on, the wheel down by the plate. The torso is
  // pitched just short of upright and DOES NOT MOVE between the frames (the cue
  // is chest out, no body english): the whole rep is the elbow travelling from
  // all but straight out front to driven back past the ribs, with the handle
  // arriving at the lower belly.
  frames: [
    { x: 64, y: 80, torso: -80, head: -80, arm: [37.5, 12.8], armF: [39, 14.3], leg: [15, 40, -60], legF: [16, 41, -58] },
    { x: 64, y: 80, torso: -80, head: -80, arm: [142.1, -2.4], armF: [143.6, -0.9], leg: [15, 40, -60], legF: [16, 41, -58] },
  ],
  props: () =>
    benchProp({ x: 54, y: 84, len: 22, floorY: FLOOR }) +
    frameProp(96, 86, FLOOR) +
    pulleyProp(116, 74, { top: 58, post: 28 }) +
    floorProp(30, 132),
  hold: { k: 'handle', from: [116, 74] },
});

const X16: ExerciseDemo = one('x16', {
  view: 'front',
  loopMs: 2800,
  forwardShare: 0.44,
  // PALLOF PRESS, square to the camera — because the picture IS the cue: the
  // cable hauls sideways from its stack and the hands never leave the body's
  // midline. "Pressed straight out in front of the sternum" is drawn the way
  // b6 draws "hands meet in front of the belly": the arms extend down the
  // picture plane, fists together on the centreline, which is this renderer's
  // honest projection of an arm reaching out at the viewer's chest height. The
  // torso, the pelvis and both planted feet are byte-identical between the
  // frames — the entire point of the lift is that only the arms move.
  frames: [
    { x: 80, y: 66, torso: -90, head: -90, arm: [57.6, -169.2], armF: [57.6, -169.2], leg: [85, 88, 20], legF: [85, 88, 20] },
    { x: 80, y: 66, torso: -90, head: -90, arm: [98.3, -245.8], armF: [98.3, -245.8], leg: [85, 88, 20], legF: [85, 88, 20] },
  ],
  props: () => pulleyProp(24, 50, { top: 8, post: 52, stack: true }) + floorProp(36, 124),
  hold: { k: 'handle', from: [24, 50] },
});

const X17: ExerciseDemo = one('x17', {
  view: 'side',
  loopMs: 3600,
  forwardShare: 0.68,
  // NEGATIVE pull-up: b2's pull-up path run the other way round. The frames
  // list top → hang, so the FORWARD pass — the one that gets two thirds of the
  // clock — is the slow, fought descent the steps prescribe, and the return is
  // the quick jump back to the top of the bar.
  frames: [...PULLUP_FRAMES].reverse(),
  props: () => barProp(58, 110, 12, 6),
  hold: { k: 'none' },
});

const X18: ExerciseDemo = one('x18', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.44,
  // CHEST-SUPPORTED ROW: the incline bench turned into a shelf — the lifter
  // lies chest-down along the 32° pad (the torso runs parallel to it, half a
  // body's thickness above), the feet brace on the floor behind, and the bells
  // hang straight down from the shoulders. The rep is b4's row without b4's
  // hinge to hold: the pad holds it, the torso is byte-identical between the
  // frames, and the elbow drives up past the ribs to the top.
  frames: [
    { x: 58, y: 76.5, torso: -32, head: -32, arm: [88, 92], armF: [90, 94], leg: [120, 145, 15], legF: [122, 147, 17] },
    { x: 58, y: 76.5, torso: -32, head: -32, arm: [187.8, 57.3], armF: [185.8, 59.3], leg: [120, 145, 15], legF: [122, 147, 17] },
  ],
  props: () => benchProp({ x: 52, y: 86, len: 44, angle: -32, floorY: FLOOR }) + floorProp(26, 132),
  hold: { k: 'db' },
});

const X19: ExerciseDemo = one('x19', {
  view: 'side',
  loopMs: 2800,
  forwardShare: 0.44,
  // MEDIUM-GRIP pulldown: b2's pulldown — the same station, the same solved
  // straight-down path — with the grip at shoulder width, so the bar drawn
  // across the hands is the short one rather than the wide lat bar.
  frames: PULLDOWN_FRAMES,
  props: pulldownProps,
  hold: { k: 'handle', from: [78, 14] },
});

const X20: ExerciseDemo = one('x20', {
  view: 'side',
  loopMs: 2600,
  forwardShare: 0.44,
  // ONE-ARM cable row: standing at a belly-height pulley in a slight staggered
  // stance, the free hand braced on the front thigh — that arm and both legs
  // are byte-identical between the frames, the same "the support side just
  // holds" contract a2's bench makes. Only the near arm rows: from reaching
  // toward the wheel to the elbow driven back past the ribs, with the cable on
  // the near fist alone.
  frames: [
    { x: 66, y: 66, torso: -75, head: -75, arm: [46.1, 5.4], armF: [98.8, 73.3], leg: [80, 90, 20], legF: [100, 82, 20] },
    { x: 66, y: 66, torso: -75, head: -75, arm: [148.2, 23.1], armF: [98.8, 73.3], leg: [80, 90, 20], legF: [100, 82, 20] },
  ],
  props: () => pulleyProp(118, 58, { top: 8, post: 44, stack: true }) + floorProp(36, 128),
  hold: { k: 'handleNear', from: [118, 58] },
});

/**
 * THE TREADMILL BELT: from the back end at the floor line up to the front, an
 * 8° climb — a real 6% incline is under 4°, and at that angle the deck reads
 * as flat, which would show the one thing the exercise is not.
 */
const BELT = { x1: 38, y1: 100, x2: 122, y2: 88 } as const;

const X21: ExerciseDemo = one('x21', {
  view: 'side',
  loopMs: 2000,
  forwardShare: 0.5,
  // INCLINE WALK: a stride and its mirror, and the yoyo between them is the
  // gait — which on a treadmill happens in place, so the pelvis never moves.
  // Each frame was solved on the belt line: the leading foot is planted flat
  // ALONG the deck (its foot angle is the deck's own −8°, ankle and toe both on
  // the belt), the trailing heel is lifted with only the toe still touching,
  // and the arms swing opposite the legs. The torso leans 8° into the climb;
  // the hands hold nothing — the coaching copy says so.
  frames: [
    { x: 80, y: 61, torso: -82, head: -82, arm: [108, 78], armF: [66, 40], leg: [70, 85, -8], legF: [110, 100, 22] },
    { x: 80, y: 61, torso: -82, head: -82, arm: [66, 40], armF: [108, 78], leg: [110, 100, 22], legF: [70, 85, -8] },
  ],
  props: () => treadmillProp({ ...BELT, floorY: FLOOR }),
  hold: { k: 'none' },
});

/** Every demonstration, in program order. */
export const EXERCISE_DEMOS: readonly ExerciseDemo[] = [
  A1, A2, A3, A4, A5, A6,
  B1, B2, B3, B4, B5, B6,
  C1, C2, C3, C4, C5, C6,
  X1, X2, X3, X4, X5, X6, X7, X8, X9, X10,
  X11, X12, X13, X14, X15, X16, X17, X18, X19, X20, X21,
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
