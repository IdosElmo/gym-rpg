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
 */
import { describe, expect, it } from 'vitest';

import {
  RIG,
  STAGE,
  angleOf,
  benchDiagProp,
  benchProp,
  dist,
  ease,
  figureSvg,
  flexion,
  forwardKinematics,
  holdAnchors,
  holdBackSvg,
  holdSvg,
  lerpPose,
  pulleyProp,
  railProp,
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

describe('forward kinematics — three quarters', () => {
  const P: Pose = { x: 80, y: 66, torso: -90, head: -90, arm: [90, 90], armF: [90, 90], leg: [90, 90, 20], legF: [90, 90, 20] };

  it('narrows the spread, splits the two sides along ONE diagonal, and shortens the far bones', () => {
    const f = forwardKinematics(P, 'front');
    const q = forwardKinematics(P, 'threeQuarter');
    // ACROSS: what survives a turn is the cosine of it — 0.62 of the full span
    const fullSpan = f.near.shoulder.x - f.far.shoulder.x;
    const turnedSpan = q.near.shoulder.x - q.far.shoulder.x;
    near(turnedSpan, RIG.shoulderHalf * 2 * 0.62 + 4); // the spread, plus the diagonal
    expect(turnedSpan).toBeLessThan(fullSpan);
    // INTO THE PAGE: the near side goes down-and-right, the far side up-and-left,
    // by the SAME vector — a parallelogram, not two unrelated nudges
    near(q.near.shoulder.y - f.near.shoulder.y, 1.7);
    near(q.far.shoulder.y - f.far.shoulder.y, -1.7);
    near(q.near.hip.y - q.pelvis.y, 1.7);
    near(q.far.hip.y - q.pelvis.y, -1.7);
    // the spine itself is untouched: only the two sides move
    expect(q.pelvis).toEqual(f.pelvis);
    expect(q.shoulders).toEqual(f.shoulders);
    expect(q.head).toEqual(f.head);
  });

  it('draws the FAR limbs shorter, because they are further away', () => {
    const q = forwardKinematics(P, 'threeQuarter');
    const nearArm = dist(q.near.shoulder, q.near.grip);
    const farArm = dist(q.far.shoulder, q.far.grip);
    near(nearArm, RIG.upperArm + RIG.forearm + RIG.hand);
    near(farArm, (RIG.upperArm + RIG.forearm + RIG.hand) * 0.85);
    near(dist(q.far.hip, q.far.toe) / dist(q.near.hip, q.near.toe), 0.85);
  });

  it('still MIRRORS the far side, so a symmetric pose is authored once', () => {
    const q = forwardKinematics({ ...P, arm: [40, 20], armF: [40, 20] }, 'threeQuarter');
    // the far elbow is the near one reflected in x about its own shoulder…
    near(q.far.elbow.x - q.far.shoulder.x, -(q.near.elbow.x - q.near.shoulder.x) * 0.85);
    near(q.far.elbow.y - q.far.shoulder.y, (q.near.elbow.y - q.near.shoulder.y) * 0.85);
  });

  it('gives the torso four corners, so a roll shapes it for free', () => {
    const flat = figureSvg(forwardKinematics(P, 'threeQuarter'), 'threeQuarter');
    expect(flat).toContain('cd-torso');
    // the same four-point silhouette the front view uses, not the side view's
    // slab about the spine
    const corners = /class="cd-torso" d="M [^"]*"/.exec(flat)?.[0] ?? '';
    expect(corners.match(/L /g)).toHaveLength(3);
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

describe('drawing', () => {
  const j = forwardKinematics(STANDING, 'side');

  it('emits a bold silhouette with no NaN anywhere', () => {
    const svg = figureSvg(j, 'side');
    expect(svg).toContain('cd-torso');
    expect(svg).toContain('cd-head');
    expect(svg).toContain('cd-limb far');
    expect(svg).toContain('cd-limb near');
    expect(svg).toContain('cd-joint');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('paints the far limbs BEFORE the torso and the near limbs after it', () => {
    const svg = figureSvg(j, 'side');
    expect(svg.indexOf('cd-limb far')).toBeLessThan(svg.indexOf('cd-torso'));
    expect(svg.indexOf('cd-torso')).toBeLessThan(svg.indexOf('cd-limb near'));
  });

  it('keeps every prop free of external references', () => {
    const props =
      benchProp({ x: 40, y: 84, len: 60 }) +
      railProp(90, 20, 90) +
      pulleyProp(100, 20, { stack: true }) +
      benchDiagProp({ a: { x: 108, y: 64 }, b: { x: 48, y: 79 }, dep: { x: 0, y: 9.5 } });
    expect(props).not.toMatch(/https?:|url\(|<image|xlink/);
    expect(props).not.toMatch(/NaN|undefined/);
  });

  it('draws a bench SEEN AT THREE QUARTERS as a parallelogram on two legs', () => {
    // a bench the body lies along diagonally is not a pad on posts seen from the
    // side: it is a surface, and its width runs along the same depth diagonal
    // the rig spreads the body on
    const slab = benchDiagProp({ a: { x: 108, y: 64 }, b: { x: 48, y: 79 }, dep: { x: 0, y: 9.5 } });
    // the pad: four corners, the far pair 9.5 above the axis and the near pair below
    expect(slab).toContain('<path class="cd-slab" d="M 108 54.5 L 48 69.5 L 48 88.5 L 108 73.5 Z"/>');
    // a lit near edge, a quiet far one, a leg at each end and a base between them
    expect(slab).toContain('class="cd-pad"');
    expect(slab.match(/class="cd-frame"/g)?.length).toBe(5);
    expect(slab).not.toMatch(/NaN|undefined/);
  });

  it('hangs a pulley off a top beam when its mast has to stand elsewhere', () => {
    // a lat pulldown's wheel is directly over the seat and its mast is behind
    // the lifter's back; drawn as one upright it would run through his thighs
    const near = pulleyProp(78, 14, { top: 8, post: 40 });
    expect(near).toContain('cx="78" cy="14"');
    const far = pulleyProp(78, 14, { top: 8, post: 40, postX: 108 });
    expect(far).toContain('cx="78" cy="14"'); // same wheel…
    expect(far).toContain('M 108 8 L 108 54'); // …a mast 30 units behind it…
    expect(far).toContain('M 108 8 L 78 8'); // …and the beam that carries it
    expect(far.length).toBeGreaterThan(near.length);
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

  it('draws a rope as ONE cable, a clip, and one end per fist — the far one behind', () => {
    // a rope has two ends and they arrive in two hands, but what hangs off the
    // machine is a single cable ending in a clip. Two full strands back to the
    // wheel left it at nearly the same angle and merged into one bar across the
    // picture; the clip is what breaks them apart.
    const hold = { k: 'rope', from: [100, 18] } as const;
    const front = holdSvg(hold, j);
    const back = holdBackSvg(hold, j);
    expect(front.match(/class="cd-cable"/g)).toHaveLength(1); // ONE cable…
    expect(front).toContain('M 100 18');
    expect(front).toContain('class="cd-clip"'); // …ending at the clip
    expect(front.match(/class="cd-rope"/g)).toHaveLength(1); // the near end in front
    expect(back.match(/class="cd-rope"/g)).toHaveLength(1); // the far end behind
    expect(back).not.toContain('cd-cable');
    expect(holdAnchors(hold, j)).toEqual([j.near.grip, j.far.grip]);
    // nothing else has a half that lives behind the body
    expect(holdBackSvg({ k: 'db' }, j)).toBe('');
    expect(holdBackSvg({ k: 'handle', from: [100, 18] }, j)).toBe('');
    // a single handle is still ONE thing in two hands: the midpoint
    const handle = holdAnchors({ k: 'handle', from: [100, 18] }, j)[0];
    near(handle?.x ?? 0, (j.near.grip.x + j.far.grip.x) / 2);
  });

  it('puts a one-hand cable handle on the NEAR fist alone', () => {
    const hold = { k: 'handleNear', from: [100, 18] } as const;
    expect(holdAnchors(hold, j)).toEqual([j.near.grip]);
    const svg = holdSvg(hold, j);
    expect(svg.match(/class="cd-cable"/g)).toHaveLength(1); // one cable to the fist
    expect(svg).toContain('M 100 18');
    expect(svg).toContain('cd-bar'); // …with the short grip bar across it
    expect(holdBackSvg(hold, j)).toBe('');
  });

  it('gives an empty hold no markup at all', () => {
    expect(holdSvg({ k: 'none' }, j)).toBe('');
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
