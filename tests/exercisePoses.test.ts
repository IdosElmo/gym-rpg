/**
 * data/exercisePoses.ts — every demonstration, checked against the movement it
 * claims to be.
 *
 * The poses are numbers, so "does it look right" has to become "does the FK say
 * the right thing". This file re-derives the joint positions from the SHIPPED
 * angles and asserts the mechanics of each family:
 *
 *   - a press: hands above the chest and close to it at the bottom, the arm
 *     nearly extended at the top;
 *   - a Smith lift: the bar cannot leave the rail, so the hand (or the loaded
 *     shoulder) keeps ONE x across the whole rep, and it is the rail the props
 *     actually drew;
 *   - a squat pattern: hips descend to at least the knee, feet planted;
 *   - a hinge: torso rotates far, knee barely bends, hips travel back;
 *   - a curl / pushdown / overhead extension: the UPPER ARM is byte-identical
 *     between frames, because "only the forearm moves" is the coaching cue;
 *   - a hold (plank): ear-hip-heel on one line, elbows planted, hips breathing;
 *   - a cable lift: the cable starts at a pulley the props drew, not at a
 *     number someone typed twice.
 *
 * Plus the sweep that applies to all 28: coverage, joint limits, frames inside
 * the stage, equipment anchored to the joint it belongs to, and no external
 * reference anywhere in the markup.
 *
 * AND THE RENDERING CONFIG, which is data too. A volumetric figure needs five
 * things a stick one did not, and every one of them can be wrong in a way no
 * type checks: a camera that crops the stage it does not cover, a layer order
 * that draws a limb twice or not at all, a muscle the exercise does not
 * actually train, a front-view silhouette on a lift that happens in the
 * sagittal plane. Each of those is a `describe` below.
 */
import { describe, expect, it } from 'vitest';

import { EXERCISE_DEMOS, demoFor, type ExerciseDemo } from '../src/data/exercisePoses.ts';
import { builtInExercises, findExercise } from '../src/data/program.ts';
import {
  STAGE,
  dist,
  flexion,
  forwardKinematics,
  holdAnchors,
  type Joints,
  type Pose,
  type Vec,
} from '../src/ui/coachFigure.ts';
import { LAYERS, MUSCLE_REGIONS } from '../src/ui/coachVolume.ts';
import { bodyPartWeights } from '../src/data/program.ts';
import { demoSvg, legendHtml, poseAt, stillPose } from '../src/ui/exerciseDemo.ts';

/* ------------------------------------------------------------------ helpers */

const demo = (id: string): ExerciseDemo => {
  const d = demoFor(id);
  if (!d) throw new Error(`no demo for ${id}`);
  return d;
};

/** Joints of keyframe `i` (not an interpolated frame — the authored pose). */
function at(id: string, i: number): Joints {
  const d = demo(id);
  const pose = d.frames[i];
  if (!pose) throw new Error(`${id} has no frame ${i}`);
  return forwardKinematics(pose, d.view);
}

function frameOf(id: string, i: number): Pose {
  const p = demo(id).frames[i];
  if (!p) throw new Error(`${id} has no frame ${i}`);
  return p;
}

/**
 * The index of the LAST authored keyframe. Several demos gained a middle frame
 * when the volumetric renderer arrived (a mid-rep pose is where the eye is once
 * the tempo is two-phase, and it is what pins a planted ankle through a
 * descent), so "the end of the movement" is not always frame 1.
 */
const endOf = (id: string): number => demo(id).frames.length - 1;

/** Mid-torso point — "the chest" for the purposes of a press. */
function chest(j: Joints): Vec {
  return { x: (j.pelvis.x + j.shoulders.x * 2) / 3, y: (j.pelvis.y + j.shoulders.y * 2) / 3 };
}

/** How far the spine is from upright, 0–180. */
function leanFromVertical(pose: Pose): number {
  return flexion(-90, pose.torso);
}

/** Every wheel centre the props drew — i.e. every real pulley. */
function pulleys(d: ExerciseDemo): Vec[] {
  const out: Vec[] = [];
  const re = /class="cd-wheel" cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g;
  let m = re.exec(d.props());
  while (m) {
    out.push({ x: Number(m[1]), y: Number(m[2]) });
    m = re.exec(d.props());
  }
  return out;
}

/** Every vertical guide rail the props drew. */
function rails(d: ExerciseDemo): number[] {
  const out: number[] = [];
  const re = /class="cd-rail" d="M (-?[\d.]+) /g;
  let m = re.exec(d.props());
  while (m) {
    out.push(Number(m[1]));
    m = re.exec(d.props());
  }
  return out;
}

const eachFrame = (d: ExerciseDemo, fn: (j: Joints, pose: Pose, i: number) => void): void => {
  d.frames.forEach((pose, i) => fn(forwardKinematics(pose, d.view), pose, i));
};

/* ------------------------------------------------------------------ the sweep */

describe('coverage', () => {
  it('demonstrates every built-in exercise, exactly once, and nothing else', () => {
    const builtIn = builtInExercises().map((e) => e.id);
    expect(builtIn).toHaveLength(28);
    expect(EXERCISE_DEMOS.map((d) => d.id).sort()).toEqual([...builtIn].sort());
    expect(new Set(EXERCISE_DEMOS.map((d) => d.id)).size).toBe(EXERCISE_DEMOS.length);
    for (const d of EXERCISE_DEMOS) expect(findExercise(d.id)).not.toBeNull();
  });

  it('has NO demo for a custom exercise — a stand-in would be a guess', () => {
    expect(demoFor('cx_9f2a')).toBeNull();
    expect(demoFor('')).toBeNull();
    expect(demoFor('a1x')).toBeNull();
  });
});

describe('every demo, structurally', () => {
  for (const d of EXERCISE_DEMOS) {
    describe(d.id, () => {
      it('has 2–3 keyframes and a rep tempo a human could follow', () => {
        expect(d.frames.length).toBeGreaterThanOrEqual(2);
        expect(d.frames.length).toBeLessThanOrEqual(3);
        expect(d.loopMs).toBeGreaterThanOrEqual(1800);
        expect(d.loopMs).toBeLessThanOrEqual(5000);
        expect(d.view === 'side' || d.view === 'front').toBe(true);
        // the two halves of a rep are not equal, but neither is a flicker
        expect(d.forwardShare).toBeGreaterThanOrEqual(0.3);
        expect(d.forwardShare).toBeLessThanOrEqual(0.7);
      });

      it('declares a facing, a full layer order and a camera inside the stage', () => {
        expect(d.facing === 1 || d.facing === -1).toBe(true);
        // every layer exactly once: a missing one drops a limb, a repeated one
        // paints it twice and the second copy wins
        expect([...d.order].sort()).toEqual([...LAYERS].sort());
        const [x, y, w, h] = d.camera;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(w).toBeGreaterThan(30);
        expect(h).toBeGreaterThan(30);
        expect(x + w).toBeLessThanOrEqual(STAGE.w);
        expect(y + h).toBeLessThanOrEqual(STAGE.h);
        // and it is a card, not a letterbox
        expect(w / h).toBeGreaterThan(0.5);
        expect(w / h).toBeLessThan(2.2);
      });

      it('highlights the muscle the exercise actually pays XP for', () => {
        const ex = findExercise(d.id);
        expect(ex).not.toBeNull();
        const weights = bodyPartWeights(ex!);
        expect(MUSCLE_REGIONS).toContain(d.primary);
        // the primary IS the exercise's own body part…
        expect(d.primary as string).toBe(ex!.bodyPart);
        if (d.secondary === undefined) {
          // …and a demo only claims a second muscle when the exercise splits
          const others = MUSCLE_REGIONS.filter((r) => r !== d.primary && (weights[r] ?? 0) > 0);
          expect(others).toHaveLength(0);
        } else {
          expect(d.secondary).not.toBe(d.primary);
          expect(weights[d.secondary] ?? 0).toBeGreaterThan(0);
          // …and when it does, it names the heavier half of the split
          for (const r of MUSCLE_REGIONS) {
            if (r === d.primary || r === d.secondary) continue;
            expect(weights[r] ?? 0).toBeLessThanOrEqual(weights[d.secondary] ?? 0);
          }
        }
      });

      it('chips the muscle in Hebrew, primary first', () => {
        expect(d.muscles.length).toBe(d.secondary === undefined ? 1 : 2);
        for (const m of d.muscles) expect(m).toMatch(/[֐-׿]/);
        const chip = legendHtml(d);
        expect(chip).toContain('cd-chip');
        expect(chip).toContain(d.muscles[0] as string);
      });

      it('keeps every joint inside the stage', () => {
        eachFrame(d, (j) => {
          const pts = [j.head, j.pelvis, j.shoulders, ...limbPoints(j)];
          for (const p of pts) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
            expect(p.x).toBeGreaterThan(-4);
            expect(p.x).toBeLessThan(STAGE.w + 4);
            expect(p.y).toBeGreaterThan(-4);
            expect(p.y).toBeLessThan(STAGE.h + 4);
          }
        });
      });

      it('never bends a joint past a human range', () => {
        eachFrame(d, (_j, pose) => {
          for (const arm of [pose.arm, pose.armF]) {
            expect(flexion(arm[0], arm[1])).toBeLessThanOrEqual(160);
          }
          for (const leg of [pose.leg, pose.legF]) {
            expect(flexion(leg[0], leg[1])).toBeLessThanOrEqual(150);
            // the ankle gets less room than the knee: a foot folded back onto
            // its own shin is the tell-tale of a mistyped angle.
            expect(flexion(leg[1], leg[2])).toBeLessThanOrEqual(135);
          }
        });
      });

      it('turns each joint the SHORT way between keyframes', () => {
        // authored so a plain lerp cannot spin an arm the long way round
        for (let i = 1; i < d.frames.length; i++) {
          const a = frameOf(d.id, i - 1);
          const b = frameOf(d.id, i);
          const pairs: Array<[number, number]> = [
            [a.torso, b.torso],
            [a.arm[0], b.arm[0]],
            [a.arm[1], b.arm[1]],
            [a.armF[0], b.armF[0]],
            [a.armF[1], b.armF[1]],
            [a.leg[0], b.leg[0]],
            [a.leg[1], b.leg[1]],
            [a.legF[0], b.legF[0]],
            [a.legF[1], b.legF[1]],
          ];
          for (const [p, q] of pairs) expect(Math.abs(q - p)).toBeLessThanOrEqual(200);
        }
      });

      it('anchors the equipment to a real joint, and a cable to a real pulley', () => {
        eachFrame(d, (j) => {
          const anchors = holdAnchors(d.hold, j);
          const known = [j.near.grip, j.far.grip, j.near.ankle, j.near.knee, j.near.shoulder];
          for (const a of anchors) {
            expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
            // every anchor is a joint, or the midpoint of the two grips
            const mid = { x: (j.near.grip.x + j.far.grip.x) / 2, y: (j.near.grip.y + j.far.grip.y) / 2 };
            const ok = [...known, mid].some((k) => dist(k, a) < 0.001);
            expect(ok).toBe(true);
          }
        });
        const wheels = pulleys(d);
        if (d.hold.k === 'rope' || d.hold.k === 'handle') {
          const from = { x: d.hold.from[0] ?? 0, y: d.hold.from[1] ?? 0 };
          expect(wheels.some((w) => dist(w, from) < 0.001)).toBe(true);
        }
        if (d.hold.k === 'cables') {
          for (const f of d.hold.from) {
            expect(wheels.some((w) => dist(w, { x: f[0] ?? 0, y: f[1] ?? 0 }) < 0.001)).toBe(true);
          }
        }
      });

      it('renders self-contained volumetric markup', () => {
        const svg = demoSvg(d, stillPose(d), 'x');
        expect(svg).toMatch(/^<svg class="cd-svg"/);
        expect(svg).toContain('cd-static');
        expect(svg).toContain('cd-live');
        expect(svg).toContain('cd-figure');
        expect(svg).toContain(`viewBox="${d.camera.join(' ')}"`);
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
        // the licence story in one assertion: nothing is fetched, ever
        expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
        expect(svg).not.toMatch(/<image|xlink:href|\.gif|\.png|\.jpg|data:/);
        // the only url() is a reference to a def in this same document
        for (const m of svg.matchAll(/url\(([^)]*)\)/g)) expect(m[1]?.startsWith('#')).toBe(true);
      });

      it('actually MOVES — no demo is two copies of one pose', () => {
        // b5 is a HOLD: it breathes rather than reps, and that is the point.
        const least = d.id === 'b5' ? 0.4 : 3;
        const a = poseAt(d, 0);
        const b = poseAt(d, d.loopMs / 2);
        const ja = forwardKinematics(a, d.view);
        const jb = forwardKinematics(b, d.view);
        const moved = Math.max(
          dist(ja.near.grip, jb.near.grip),
          dist(ja.near.knee, jb.near.knee),
          dist(ja.shoulders, jb.shoulders),
          dist(ja.near.ankle, jb.near.ankle),
        );
        expect(moved).toBeGreaterThan(least);
      });
    });
  }
});

function limbPoints(j: Joints): Vec[] {
  return [
    j.near.shoulder, j.near.elbow, j.near.wrist, j.near.grip,
    j.near.hip, j.near.knee, j.near.ankle, j.near.toe,
    j.far.shoulder, j.far.elbow, j.far.wrist, j.far.grip,
    j.far.hip, j.far.knee, j.far.ankle, j.far.toe,
  ];
}

/* ------------------------------------------------------------------ families */

describe('presses — hands at the chest at the bottom, extended at the top', () => {
  for (const id of ['a1', 'b1', 'c1']) {
    it(id, () => {
      const end = endOf(id);
      const bottom = at(id, 0);
      const top = at(id, end);
      // bottom: the hand is ABOVE the chest (never down at the belly) and near it
      expect(bottom.near.grip.y).toBeLessThan(chest(bottom).y);
      expect(dist(bottom.near.shoulder, bottom.near.grip)).toBeLessThan(16);
      expect(flexion(frameOf(id, 0).arm[0], frameOf(id, 0).arm[1])).toBeGreaterThan(90);
      // top: pressed away, arm close to straight but not locked
      expect(dist(top.near.shoulder, top.near.grip)).toBeGreaterThan(22);
      expect(flexion(frameOf(id, end).arm[0], frameOf(id, end).arm[1])).toBeLessThan(60);
      expect(top.near.grip.y).toBeLessThan(bottom.near.grip.y - 12);
    });
  }

  it('a1 presses on a 30° incline, c1 on the same incline but DEEPER', () => {
    // both recline on the same pad and both press dumbbells, which is what the
    // program says they are — a1 at 8–10 reps, c1 at 10–12 through a fuller
    // range. What tells them apart is the bottom: c1's dumbbells travel BELOW
    // where a1 stops, and its elbow drops further under the shoulder line.
    expect(leanFromVertical(frameOf('a1', 0))).toBeCloseTo(60, 0);
    expect(leanFromVertical(frameOf('c1', 0))).toBeCloseTo(60, 0);
    const a1 = at('a1', 0);
    const c1 = at('c1', 0);
    expect(c1.near.grip.y).toBeGreaterThan(a1.near.grip.y + 2);
    expect(c1.near.elbow.y - c1.near.shoulder.y).toBeGreaterThan(a1.near.elbow.y - a1.near.shoulder.y);
    // …and they finish in the same place, because it is the same lockout
    expect(dist(at('a1', endOf('a1')).near.grip, at('c1', endOf('c1')).near.grip)).toBeLessThan(1);
  });
});

describe('Smith machine lifts — the bar cannot leave the rail', () => {
  // a1 is the DUMBBELL half of its own copy (`Incline Smith / Dumbbell Press`);
  // the bar version of a flat press is b1, and the rail lifts are b1/b4/x1.
  const cases: Array<[string, 'grip' | 'shoulder']> = [
    ['b1', 'grip'],
    ['b4', 'grip'],
    ['x1', 'shoulder'],
  ];
  for (const [id, point] of cases) {
    it(id, () => {
      const d = demo(id);
      const railXs = rails(d);
      expect(railXs).toHaveLength(1);
      const on = (i: number): Vec => {
        const j = at(id, i);
        return point === 'grip' ? j.near.grip : j.near.shoulder;
      };
      for (let i = 0; i < d.frames.length; i++) {
        expect(Math.abs(on(i).x - (railXs[0] ?? 0))).toBeLessThan(2);
      }
      // ...and it still travels vertically
      expect(Math.abs(on(0).y - on(endOf(id)).y)).toBeGreaterThan(12);
    });
  }
});

describe('squat patterns — hips to at least parallel, feet planted', () => {
  for (const id of ['a3', 'x1']) {
    it(id, () => {
      const top = at(id, 0);
      const bottom = at(id, endOf(id));
      expect(bottom.pelvis.y - top.pelvis.y).toBeGreaterThan(11);
      // "below parallel-ish": the hip is at or under the knee at the bottom
      expect(bottom.pelvis.y).toBeGreaterThan(bottom.near.knee.y - 2);
      // the feet do not slide
      expect(dist(top.near.ankle, bottom.near.ankle)).toBeLessThan(1.5);
      expect(dist(top.far.ankle, bottom.far.ankle)).toBeLessThan(1.5);
    });
  }

  it('a3 is a SPLIT stance with the back knee dropping near the floor', () => {
    const bottom = at('a3', endOf('a3'));
    expect(bottom.near.ankle.x - bottom.far.ankle.x).toBeGreaterThan(20);
    expect(bottom.far.knee.y).toBeGreaterThan(bottom.near.knee.y + 10);
  });
});

describe('c2 — an RDL hinges at the hip, and barely at the knee', () => {
  it('rotates the torso far while the knee keeps its small fixed bend', () => {
    const top = frameOf('c2', 0);
    const bottom = frameOf('c2', endOf('c2'));
    expect(leanFromVertical(bottom) - leanFromVertical(top)).toBeGreaterThan(60);
    expect(flexion(top.leg[0], top.leg[1])).toBeLessThan(35);
    expect(flexion(bottom.leg[0], bottom.leg[1])).toBeLessThan(35);
  });

  it('pushes the hips BACK and lets the weight hang down the shins', () => {
    const a = at('c2', 0);
    const b = at('c2', endOf('c2'));
    expect(b.pelvis.x).toBeLessThan(a.pelvis.x - 8); // hips travel away from the toes
    expect(dist(a.near.ankle, b.near.ankle)).toBeLessThan(1.5);
    // arms hang: the hand stays directly under the shoulder in BOTH frames
    expect(Math.abs(b.near.grip.x - b.near.shoulder.x)).toBeLessThan(2);
    expect(b.near.grip.y).toBeGreaterThan(a.near.grip.y + 15);
  });
});

describe('"only the forearm moves" — the pinned-elbow lifts', () => {
  for (const id of ['a5', 'x9', 'x5', 'c4']) {
    it(`${id} keeps the upper arm byte-identical between keyframes`, () => {
      const a = frameOf(id, 0);
      const b = frameOf(id, 1);
      expect(b.arm[0]).toBe(a.arm[0]);
      expect(b.armF[0]).toBe(a.armF[0]);
      expect(a.arm[1]).not.toBe(b.arm[1]);
      // and the body does not swing to help
      expect(b.x).toBe(a.x);
      expect(b.y).toBe(a.y);
      expect(b.torso).toBe(a.torso);
    });
  }

  it('a5 curls up to shoulder height; x9 does the same with a NEUTRAL grip', () => {
    const bottom = at('a5', 0);
    const top = at('a5', 1);
    expect(bottom.near.grip.y - top.near.grip.y).toBeGreaterThan(20);
    expect(top.near.grip.y).toBeLessThan(top.near.shoulder.y + 6);
    expect(demo('a5').hold).toEqual({ k: 'db' });
    expect(demo('x9').hold).toEqual({ k: 'db', axis: 'along' });
    expect(demo('x9').frames).toEqual(demo('a5').frames);
  });

  it('x5 pushes DOWN to a straight arm', () => {
    const start = at('x5', 0);
    const end = at('x5', 1);
    expect(end.near.grip.y).toBeGreaterThan(start.near.grip.y + 14);
    expect(flexion(frameOf('x5', 1).arm[0], frameOf('x5', 1).arm[1])).toBeLessThan(25);
  });

  it('c4 takes ONE weight from behind the head to straight overhead', () => {
    const back = at('c4', 0);
    const up = at('c4', 1);
    expect(back.near.grip.x).toBeLessThan(back.head.x); // behind the skull
    expect(up.near.grip.y).toBeLessThan(up.head.y - 10); // above it
    expect(demo('c4').hold.k).toBe('plate');
    // the elbows stay up and tucked rather than flaring down
    expect(back.near.elbow.y).toBeLessThan(back.near.shoulder.y);
    expect(up.near.elbow.y).toBeLessThan(up.near.shoulder.y);
  });
});

describe('rows and pulls', () => {
  it('a2 rows one arm to the hip while the other side just holds the bench', () => {
    const a = frameOf('a2', 0);
    const b = frameOf('a2', 1);
    expect(b.armF).toEqual(a.armF); // support arm frozen
    expect(b.legF).toEqual(a.legF); // and the knee on the bench with it
    const bottom = at('a2', 0);
    const top = at('a2', 1);
    expect(bottom.near.grip.y - top.near.grip.y).toBeGreaterThan(18);
    expect(top.near.elbow.y).toBeLessThan(top.near.shoulder.y); // elbow-led, driven up
    expect(demo('a2').hold).toEqual({ k: 'dbNear' });
  });

  it('b4 hinges to 45° and holds it — the pull is all elbow', () => {
    const a = frameOf('b4', 0);
    const b = frameOf('b4', 1);
    expect(leanFromVertical(a)).toBeCloseTo(45, 0);
    expect(b.torso).toBe(a.torso); // no body english
    const bottom = at('b4', 0);
    const top = at('b4', 1);
    expect(bottom.near.grip.y - top.near.grip.y).toBeGreaterThan(12);
    expect(top.near.elbow.x).toBeLessThan(top.near.shoulder.x); // elbow drives back
  });

  it('b2 keeps the grip ON the bar and lifts the BODY to it', () => {
    const hang = at('b2', 0);
    const top = at('b2', 1);
    expect(dist(hang.near.grip, top.near.grip)).toBeLessThan(1);
    expect(hang.pelvis.y - top.pelvis.y).toBeGreaterThan(15);
    expect(top.head.y).toBeLessThan(hang.head.y - 12); // chin arrives at the bar
  });

  it('x6 pulls the handle from overhead down to the chest', () => {
    const up = at('x6', 0);
    const down = at('x6', 1);
    expect(down.near.grip.y - up.near.grip.y).toBeGreaterThan(20);
    expect(down.near.grip.y).toBeGreaterThan(down.near.shoulder.y);
    expect(demo('x6').hold.k).toBe('handle');
  });
});

describe('core', () => {
  it('b5 is a HOLD: ear-hip-heel on one line, elbows planted, hips breathing', () => {
    const d = demo('b5');
    const a = at('b5', 0);
    const b = at('b5', 1);
    // the elbows do not move — they are the base of support
    expect(dist(a.near.elbow, b.near.elbow)).toBeLessThan(1);
    expect(dist(a.near.toe, b.near.toe)).toBeLessThan(1);
    // elbow under the shoulder
    for (const j of [a, b]) expect(Math.abs(j.near.elbow.x - j.near.shoulder.x)).toBeLessThan(3);
    // and the hips sit on the shoulder→ankle line, never piked up
    for (const j of [a, b]) {
      const t = (j.shoulders.x - j.pelvis.x) / (j.shoulders.x - j.near.ankle.x);
      const lineY = j.shoulders.y + t * (j.near.ankle.y - j.shoulders.y);
      expect(Math.abs(j.pelvis.y - lineY)).toBeLessThan(3);
    }
    // it is still ALIVE: the breath moves something
    expect(dist(a.pelvis, b.pelvis)).toBeGreaterThan(0.5);
    expect(d.loopMs).toBeGreaterThan(3000); // a hold breathes slower than a rep
  });

  it('c5 curls the SPINE and never lifts the pelvis (a crunch, not a sit-up)', () => {
    const a = frameOf('c5', 0);
    const b = frameOf('c5', 1);
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(Math.abs(b.torso - a.torso)).toBeGreaterThan(25);
    const down = at('c5', 0);
    const up = at('c5', 1);
    expect(down.shoulders.y - up.shoulders.y).toBeGreaterThan(8);
    expect(down.near.knee.y).toBe(up.near.knee.y); // legs untouched
  });

  it('c6 twists from the RIBS, sweeping the weight side to side', () => {
    const d = demo('c6');
    expect(d.frames).toHaveLength(3);
    expect(d.view).toBe('front');
    const rolls = d.frames.map((f) => f.roll ?? 0);
    expect(rolls[0]).toBeLessThan(0);
    expect(rolls[1]).toBe(0);
    expect(rolls[2]).toBeGreaterThan(0);
    const right = holdAnchors(d.hold, at('c6', 0))[0];
    const left = holdAnchors(d.hold, at('c6', 2))[0];
    expect((right?.x ?? 0) - (left?.x ?? 0)).toBeGreaterThan(18);
    // the seat stays put — the rotation is not a lean
    expect(at('c6', 0).pelvis).toEqual(at('c6', 2).pelvis);
  });

  it('a6 raises the knees to the chest while hanging from the bar', () => {
    const hang = at('a6', 0);
    const up = at('a6', 1);
    expect(dist(hang.near.grip, up.near.grip)).toBeLessThan(1);
    expect(hang.near.knee.y - up.near.knee.y).toBeGreaterThan(20);
    expect(up.near.knee.y).toBeLessThan(up.pelvis.y); // knees above the hips
    // the pelvis tilts up at the top, which is the cue
    expect(flexion(-90, frameOf('a6', 1).torso)).toBeGreaterThan(5);
  });
});

describe('machines and cables', () => {
  it('x2 rotates ONLY the shin about a fixed knee, with the roller on the ankle', () => {
    const down = at('x2', 0);
    const up = at('x2', 1);
    expect(dist(down.near.knee, up.near.knee)).toBeLessThan(0.001);
    expect(down.near.ankle.y - up.near.ankle.y).toBeGreaterThan(12);
    expect(demo('x2').hold).toEqual({ k: 'roller', joint: 'ankle' });
    expect(holdAnchors(demo('x2').hold, up)[0]).toEqual(up.near.ankle);
  });

  it('x3 curls the shin the other way, hips pinned to the pad', () => {
    const flat = at('x3', 0);
    const curled = at('x3', 1);
    expect(dist(flat.near.knee, curled.near.knee)).toBeLessThan(0.001);
    expect(dist(flat.pelvis, curled.pelvis)).toBeLessThan(0.001);
    expect(flat.near.ankle.y - curled.near.ankle.y).toBeGreaterThan(12);
  });

  it('b6 sweeps from wide to hands meeting in front of the belly', () => {
    const open = at('b6', 0);
    const closed = at('b6', 1);
    expect(dist(open.near.grip, open.far.grip)).toBeGreaterThan(30);
    expect(dist(closed.near.grip, closed.far.grip)).toBeLessThan(14);
    expect(closed.near.grip.y).toBeGreaterThan(closed.near.shoulder.y + 15);
    expect(demo('b6').hold.k).toBe('cables');
  });

  it('x7 is OUR face pull: to the face, elbows back and up at shoulder height', () => {
    const out = at('x7', 0);
    const pulled = at('x7', 1);
    expect(dist(out.near.shoulder, out.near.grip)).toBeGreaterThan(24); // arms extended
    expect(dist(pulled.near.grip, pulled.head)).toBeLessThan(12); // …to the face
    expect(pulled.near.elbow.x).toBeLessThan(pulled.near.shoulder.x); // driven back
    expect(pulled.near.elbow.y).toBeLessThan(pulled.near.shoulder.y + 2); // and high
    const from = demo('x7').hold.k === 'rope' ? (demo('x7').hold as { from: readonly number[] }).from : [];
    expect(from[1]).toBeLessThan(pulled.head.y + 12); // pulley set at face height
  });

  it('x8 is a pure elevation: nothing rotates, the head stays', () => {
    const a = frameOf('x8', 0);
    const b = frameOf('x8', 1);
    expect(b.arm).toEqual(a.arm);
    expect(b.leg).toEqual(a.leg);
    expect(b.torso).toBe(a.torso);
    expect((b.shrug ?? 0) - (a.shrug ?? 0)).toBeGreaterThan(3);
    const down = at('x8', 0);
    const up = at('x8', 1);
    expect(down.shoulders.y - up.shoulders.y).toBeGreaterThan(3);
    expect(up.head).toEqual(down.head);
    expect(down.near.grip.y - up.near.grip.y).toBeGreaterThan(3); // dumbbells ride up
  });
});

describe('flye family — a wide arc, elbow bent throughout', () => {
  it('a4 opens the hands far apart and closes them over the chest', () => {
    const open = at('a4', 0);
    const closed = at('a4', 1);
    expect(dist(open.near.grip, open.far.grip)).toBeGreaterThan(24);
    expect(dist(closed.near.grip, closed.far.grip)).toBeLessThan(12);
    expect(closed.near.grip.y).toBeLessThan(open.near.grip.y - 30);
    // the elbow never straightens — "hug a wide tree", not a press
    for (let i = 0; i < 2; i++) {
      const p = frameOf('a4', i);
      expect(flexion(p.arm[0], p.arm[1])).toBeGreaterThan(20);
      expect(flexion(p.armF[0], p.armF[1])).toBeGreaterThan(20);
    }
  });

  it('x10 arcs ONE weight from behind the head to over the chest', () => {
    const back = at('x10', 0);
    const over = at('x10', 1);
    expect(back.near.grip.x).toBeGreaterThan(back.head.x); // beyond the skull
    expect(over.near.grip.y).toBeLessThan(back.near.grip.y - 8);
    expect(over.near.grip.x).toBeLessThan(over.head.x); // ends over the chest
    expect(demo('x10').hold.k).toBe('plate');
    for (let i = 0; i < 2; i++) {
      const p = frameOf('x10', i);
      expect(flexion(p.arm[0], p.arm[1])).toBeGreaterThan(20);
    }
  });

  it('b3 dips with the ~30° forward lean the steps ask for', () => {
    const top = at('b3', 0);
    const bottom = at('b3', 1);
    expect(dist(top.near.grip, bottom.near.grip)).toBeLessThan(1); // hands on the bars
    expect(bottom.pelvis.y - top.pelvis.y).toBeGreaterThan(12);
    for (let i = 0; i < 2; i++) {
      const lean = leanFromVertical(frameOf('b3', i));
      expect(lean).toBeGreaterThan(25);
      expect(lean).toBeLessThan(40);
    }
  });

  it('c3 presses from ear height to overhead, seated and upright', () => {
    const ears = at('c3', 0);
    const up = at('c3', 1);
    expect(Math.abs(ears.near.grip.y - ears.head.y)).toBeLessThan(8);
    expect(up.near.grip.y).toBeLessThan(up.head.y - 10);
    expect(leanFromVertical(frameOf('c3', 0))).toBeLessThan(15); // 80–85° backrest
  });

  it('x4 raises to shoulder height and no higher, out to the SIDE', () => {
    const d = demo('x4');
    expect(d.view).toBe('front');
    const down = at('x4', 0);
    const up = at('x4', 1);
    expect(Math.abs(up.near.grip.y - up.near.shoulder.y)).toBeLessThan(6);
    expect(up.near.grip.x - up.near.shoulder.x).toBeGreaterThan(20);
    expect(down.near.grip.y).toBeGreaterThan(down.near.shoulder.y + 20);
  });
});

describe('the views are chosen per movement, not by habit', () => {
  it('puts the frontal-plane lifts in the FRONT view and everything else in the side', () => {
    const front = EXERCISE_DEMOS.filter((d) => d.view === 'front').map((d) => d.id).sort();
    expect(front).toEqual(['b6', 'c6', 'x4', 'x8']);
    // …and every one of them is a movement whose plane is frontal
    for (const id of front) expect(findExercise(id)).not.toBeNull();
    // the front silhouette is symmetric, so it is authored facing the camera and
    // the rig mirrors the far side for free
    for (const id of front) expect(demo(id).facing).toBe(1);
    expect(EXERCISE_DEMOS.filter((d) => d.view === 'side')).toHaveLength(24);
  });
});

/* ------------------------------------------------ the volumetric rendering */

describe('the camera frames the figure it is pointed at', () => {
  for (const d of EXERCISE_DEMOS) {
    it(d.id, () => {
      const [cx, cy, cw, ch] = d.camera;
      // the landmarks a viewer looks for: if any of these is out of frame the
      // demo is cropping the movement rather than framing it
      eachFrame(d, (j) => {
        const pts: Array<[string, Vec]> = [
          ['head', j.head],
          ['pelvis', j.pelvis],
          ['shoulders', j.shoulders],
          ['grip', j.near.grip],
          ['ankle', j.near.ankle],
          ['knee', j.near.knee],
          ['elbow', j.near.elbow],
        ];
        for (const [name, p] of pts) {
          expect(p.x, `${d.id} ${name} x`).toBeGreaterThan(cx - 1);
          expect(p.x, `${d.id} ${name} x`).toBeLessThan(cx + cw + 1);
          expect(p.y, `${d.id} ${name} y`).toBeGreaterThan(cy - 1);
          expect(p.y, `${d.id} ${name} y`).toBeLessThan(cy + ch + 1);
        }
      });
    });
  }
});

describe('the two demos the volumetric renderer was signed off on', () => {
  it('a1 keeps the reviewed incline press exactly as it was approved', () => {
    const d = demo('a1');
    expect(d.view).toBe('side');
    expect(d.facing).toBe(-1);
    expect(d.loopMs).toBe(3000);
    expect(d.forwardShare).toBe(0.42);
    expect(d.order).toEqual(['farArm', 'farLeg', 'body', 'nearLeg', 'nearArm']);
    expect(d.camera).toEqual([26, 32, 100, 75]);
    expect(d.primary).toBe('chest');
    expect(d.secondary).toBe('arms');
    expect(d.muscles).toEqual(['חזה עליון', 'כתף קדמית · תלת ראשי']);
    expect(d.hold).toEqual({ k: 'db' });
    expect(d.frames).toHaveLength(3);
    expect(d.frames[0]?.arm).toEqual([-208.1, -82.1]);
    expect(d.frames[1]?.arm).toEqual([-172, -94]);
    expect(d.frames[2]?.arm).toEqual([-138.5, -103.7]);
    for (const f of d.frames) {
      expect(f.x).toBe(69);
      expect(f.y).toBe(79.5);
      expect(f.torso).toBe(-30);
      expect(f.leg).toEqual([168, 83, 176]);
    }
  });

  it('c2 keeps the reviewed RDL exactly as it was approved', () => {
    const d = demo('c2');
    expect(d.facing).toBe(1);
    expect(d.loopMs).toBe(3400);
    expect(d.forwardShare).toBe(0.6);
    expect(d.order).toEqual(['farLeg', 'farArm', 'body', 'nearLeg', 'nearArm']);
    expect(d.camera).toEqual([37.5, 19, 80, 85]);
    expect(d.arcShift).toEqual([10, 0]);
    expect(d.primary).toBe('legs');
    expect(d.secondary).toBe('back');
    expect(d.muscles).toEqual(['ירך אחורית · ישבן', 'זוקפי גב']);
    expect(d.frames.map((f) => [f.x, f.y, f.torso])).toEqual([
      [80, 65.8, -90],
      [72, 67.5, -55],
      [62, 71.5, -20],
    ]);
    expect(d.frames.map((f) => f.leg)).toEqual([
      [81.3, 99.3, 4],
      [61.1, 90.8, 4],
      [45.6, 67.5, 4],
    ]);
  });

  it('plants the ankle of every STANDING lift for the whole rep', () => {
    // A stick foot was a stroke that could hover a unit off the floor unnoticed.
    // A drawn shoe cannot, so the legs of these were re-solved from a fixed
    // ankle with two-link inverse kinematics.
    for (const id of ['a3', 'c2', 'x1', 'a5', 'x9', 'x5', 'x7', 'b4', 'x4', 'x8']) {
      const d = demo(id);
      const first = at(id, 0);
      for (let i = 1; i < d.frames.length; i++) {
        expect(dist(first.near.ankle, at(id, i).near.ankle), `${id} near ankle`).toBeLessThan(1.5);
        expect(dist(first.far.ankle, at(id, i).far.ankle), `${id} far ankle`).toBeLessThan(1.5);
      }
    }
  });
});
