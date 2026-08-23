/**
 * ui/coachFigure.ts — the rig itself.
 *
 * The whole feature rests on one claim: a pose is a set of ABSOLUTE segment
 * angles, and forward kinematics turns it into joint positions that everything
 * else (the drawing, the dumbbell in the hand, the roller on the ankle, the
 * per-exercise assertions in `exercisePoses.test.ts`) reads off. So this file
 * pins the chain down on canonical poses where the answer is arithmetic:
 * straight down is exactly `thigh + shin` below the hip, `-90` is exactly
 * `torso` above the pelvis, a front-view far limb is the mirror of the near
 * one, and a shrug moves the shoulders WITHOUT carrying the head with them.
 *
 * NOTHING HERE DRAWS. The rig stopped owning any paint when the volumetric
 * renderer took over; what the picture looks like is
 * `tests/coachVolume.test.ts`'s business, and what the demos DO with the rig is
 * `tests/exercisePoses.test.ts`'s. This file is the arithmetic underneath both.
 */
import { describe, expect, it } from 'vitest';

import {
  RIG,
  STAGE,
  angleOf,
  dist,
  ease,
  flexion,
  forwardKinematics,
  holdAnchors,
  lerpPose,
  step,
  type Pose,
} from '../src/ui/coachFigure.ts';

/** An upright figure with everything hanging straight down. */
const STANDING: Pose = {
  x: 80,
  y: 66,
  torso: -90,
  head: -90,
  arm: [90, 90],
  armF: [90, 90],
  leg: [90, 90, 0],
  legF: [90, 90, 0],
};

const near = (a: number, b: number, eps = 1e-6): void => {
  expect(Math.abs(a - b)).toBeLessThan(eps);
};

describe('segment maths', () => {
  it('walks a bone in the documented direction (-90 is up, 90 is down)', () => {
    const o = { x: 10, y: 10 };
    near(step(o, -90, 5).y, 5);
    near(step(o, -90, 5).x, 10);
    near(step(o, 90, 5).y, 15);
    near(step(o, 0, 5).x, 15);
    near(step(o, 180, 5).x, 5);
  });

  it('reads an angle back off two points', () => {
    for (const deg of [-170, -90, -12, 0, 45, 179]) {
      const p = step({ x: 0, y: 0 }, deg, 7);
      near(angleOf({ x: 0, y: 0 }, p), deg, 1e-9);
      near(dist({ x: 0, y: 0 }, p), 7, 1e-9);
    }
  });

  it('measures flexion as the turn between two bones, never past 180', () => {
    expect(flexion(90, 90)).toBe(0);
    expect(flexion(90, 0)).toBe(90);
    expect(flexion(-90, 90)).toBe(180);
    // the wrap that matters: an angle authored as -210 is 150, and the turn to
    // -120 is 90 degrees — not 270.
    expect(flexion(-210.9, -120.5)).toBeCloseTo(90.4, 6);
    expect(flexion(350, 10)).toBeCloseTo(20, 6);
  });
});

describe('forward kinematics — side view', () => {
  const j = forwardKinematics(STANDING, 'side');

  it('stacks the spine exactly one torso above the pelvis', () => {
    near(j.pelvis.x, 80);
    near(j.neck.x, 80);
    near(j.neck.y, 66 - RIG.torso);
    near(j.shoulders.y, j.neck.y);
    near(j.head.y, j.neck.y - RIG.neck);
  });

  it('hangs a straight arm exactly upperArm+forearm below the shoulder', () => {
    near(j.near.elbow.y, j.shoulders.y + RIG.upperArm);
    near(j.near.wrist.y, j.shoulders.y + RIG.upperArm + RIG.forearm);
    near(j.near.grip.y, j.shoulders.y + RIG.upperArm + RIG.forearm + RIG.hand);
    expect(flexion(STANDING.arm[0], STANDING.arm[1])).toBe(0);
  });

  it('hangs a straight leg exactly thigh+shin below the hip', () => {
    near(j.near.knee.y, 66 + RIG.thigh);
    near(j.near.ankle.y, 66 + RIG.thigh + RIG.shin);
    near(j.near.toe.x, j.near.ankle.x + RIG.foot);
  });

  it('offsets the FAR limbs for depth and nothing else', () => {
    // the only difference between two identical sides is the depth nudge
    near(j.far.knee.y, j.near.knee.y);
    expect(j.far.knee.x).toBeLessThan(j.near.knee.x);
    near(j.near.knee.x - j.far.knee.x, j.near.ankle.x - j.far.ankle.x);
  });
});

describe('forward kinematics — front view', () => {
  it('spreads the shoulders and hips, and MIRRORS the far side', () => {
    const j = forwardKinematics(STANDING, 'front');
    near(j.near.shoulder.x, 80 + RIG.shoulderHalf);
    near(j.far.shoulder.x, 80 - RIG.shoulderHalf);
    near(j.near.hip.x, 80 + RIG.hipHalf);
    near(j.far.hip.x, 80 - RIG.hipHalf);

    // an arm raised out to the NEAR side lands mirrored on the far one
    const raised: Pose = { ...STANDING, arm: [-10, 5], armF: [-10, 5] };
    const r = forwardKinematics(raised, 'front');
    near(r.near.grip.y, r.far.grip.y);
    near(r.near.grip.x - r.near.shoulder.x, -(r.far.grip.x - r.far.shoulder.x));
    expect(r.near.grip.x).toBeGreaterThan(r.near.shoulder.x);
    expect(r.far.grip.x).toBeLessThan(r.far.shoulder.x);
  });

  it('rolls the shoulder line about the neck (the russian twist)', () => {
    const rolled = forwardKinematics({ ...STANDING, roll: -25 }, 'front');
    expect(rolled.near.shoulder.y).toBeLessThan(rolled.far.shoulder.y);
    near(dist(rolled.near.shoulder, rolled.far.shoulder), RIG.shoulderHalf * 2, 1e-9);
    // the neck itself does not move: the twist is at the ribs
    near(rolled.neck.x, forwardKinematics(STANDING, 'front').neck.x);
  });
});

describe('shrug', () => {
  it('raises the shoulders and the arms with them — and leaves the head alone', () => {
    const flat = forwardKinematics(STANDING, 'front');
    const up = forwardKinematics({ ...STANDING, shrug: 6 }, 'front');
    near(up.shoulders.y, flat.shoulders.y - 6);
    near(up.near.grip.y, flat.near.grip.y - 6);
    // THE point of the exercise: the traps come to the ears, the skull does not
    // ride up with them.
    near(up.head.y, flat.head.y);
    near(up.pelvis.y, flat.pelvis.y);
  });
});

describe('lerpPose / ease', () => {
  const a = STANDING;
  const b: Pose = { ...STANDING, y: 86, torso: -70, arm: [10, 20], roll: 30, shrug: 4 };

  it('blends every field, including the optional ones', () => {
    const m = lerpPose(a, b, 0.5);
    near(m.y, 76);
    near(m.torso, -80);
    near(m.arm[0], 50);
    near(m.arm[1], 55);
    near(m.roll ?? 0, 15);
    near(m.shrug ?? 0, 2);
  });

  it('returns the endpoints exactly at t=0 and t=1', () => {
    expect(lerpPose(a, b, 0).y).toBe(a.y);
    expect(lerpPose(a, b, 1).torso).toBe(b.torso);
  });

  it('eases in and out, clamped, symmetric about the middle', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 12);
    expect(ease(-3)).toBe(0);
    expect(ease(9)).toBe(1);
    // slow at the ends is the whole point of a controlled rep
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
    for (let t = 0; t < 1; t += 0.05) expect(ease(t + 0.05)).toBeGreaterThan(ease(t));
  });
});

describe('what the hands hold is read off the joints', () => {
  const j = forwardKinematics(STANDING, 'side');

  it('anchors a dumbbell to each grip, and one plate to the midpoint', () => {
    expect(holdAnchors({ k: 'db' }, j)).toEqual([j.near.grip, j.far.grip]);
    expect(holdAnchors({ k: 'dbNear' }, j)).toEqual([j.near.grip]);
    const plate = holdAnchors({ k: 'plate' }, j)[0];
    near(plate?.x ?? 0, (j.near.grip.x + j.far.grip.x) / 2);
    expect(holdAnchors({ k: 'bar' }, j)).toEqual([j.near.grip]);
    expect(holdAnchors({ k: 'barBack' }, j)).toEqual([j.near.shoulder]);
  });

  it('rides a machine roller on the joint it names', () => {
    expect(holdAnchors({ k: 'roller', joint: 'ankle' }, j)).toEqual([j.near.ankle]);
    expect(holdAnchors({ k: 'roller', joint: 'knee' }, j)).toEqual([j.near.knee]);
  });

  it('puts a two-handed weight at the midpoint of the two grips, not at one', () => {
    const rope = holdAnchors({ k: 'rope', from: [100, 18] }, j)[0];
    const handle = holdAnchors({ k: 'handle', from: [100, 18] }, j)[0];
    const mid = { x: (j.near.grip.x + j.far.grip.x) / 2, y: (j.near.grip.y + j.far.grip.y) / 2 };
    near(rope?.x ?? 0, mid.x);
    near(handle?.y ?? 0, mid.y);
    // a crossover has one cable per hand, so it has two anchors
    expect(holdAnchors({ k: 'cables', from: [[10, 10], [150, 10]] }, j)).toEqual([j.near.grip, j.far.grip]);
  });

  it('gives an empty hold no anchor at all', () => {
    expect(holdAnchors({ k: 'none' }, j)).toEqual([]);
  });
});

describe('the stage', () => {
  it('is wider than tall, with the floor near the bottom', () => {
    expect(STAGE.w).toBeGreaterThan(STAGE.h);
    expect(STAGE.floorY).toBeLessThan(STAGE.h);
    expect(STAGE.floorY).toBeGreaterThan(STAGE.h * 0.7);
  });
});
