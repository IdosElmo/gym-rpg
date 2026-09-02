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
 */
import { describe, expect, it } from 'vitest';

import { EXERCISE_DEMOS, demoFor, type DemoVariant, type ExerciseDemo } from '../src/data/exercisePoses.ts';
import { builtInExercises, findExercise } from '../src/data/program.ts';
import {
  STAGE,
  angleOf,
  dist,
  flexion,
  forwardKinematics,
  frameAt,
  holdAnchors,
  holdBackSvg,
  holdSvg,
  type Joints,
  type Pose,
  type SideJoints,
  type Vec,
} from '../src/ui/coachFigure.ts';
import { demoSvg, poseAt, stillPose } from '../src/ui/exerciseDemo.ts';

/* ------------------------------------------------------------------ helpers */

const exercise = (id: string): ExerciseDemo => {
  const d = demoFor(id);
  if (!d) throw new Error(`no demo for ${id}`);
  return d;
};

/**
 * ONE VARIANT of an exercise. `demo('b4')` is the first way of doing it — the
 * one the exercise's own name leads with — and `demo('b4', 1)` the second.
 * Almost every assertion below is about a variant rather than an exercise,
 * because a variant is what has a pose at all.
 */
const demo = (id: string, vi = 0): DemoVariant => {
  const v = exercise(id).variants[vi];
  if (!v) throw new Error(`${id} has no variant ${vi}`);
  return v;
};

/** Every variant of every exercise, tagged with the id it belongs to. */
const ALL: Array<{ id: string; vi: number; tag: string; v: DemoVariant }> = EXERCISE_DEMOS.flatMap((d) =>
  d.variants.map((v, vi) => ({ id: d.id, vi, tag: d.variants.length > 1 ? `${d.id}.${vi}` : d.id, v })),
);

/** Joints of keyframe `i` (not an interpolated frame — the authored pose). */
function at(id: string, i: number, vi = 0): Joints {
  const d = demo(id, vi);
  const pose = d.frames[i];
  if (!pose) throw new Error(`${id} has no frame ${i}`);
  return forwardKinematics(pose, d.view);
}

function frameOf(id: string, i: number, vi = 0): Pose {
  const p = demo(id, vi).frames[i];
  if (!p) throw new Error(`${id} has no frame ${i}`);
  return p;
}

/**
 * The index of the LAST authored keyframe. Several demos carry a middle one —
 * a guided bar needs a third point or a straight lerp bows it off its rail, and
 * a free press needs one or it travels an arc — so "the end of the movement" is
 * not always frame 1.
 */
const endOf = (id: string, vi = 0): number => demo(id, vi).frames.length - 1;

/** The pose `u` of the way along the authored pass, interpolated. */
const tween = (d: DemoVariant, u: number): Joints => forwardKinematics(frameAt(d.frames, u), d.view);

/** Mid-torso point — "the chest" for the purposes of a press. */
function chest(j: Joints): Vec {
  return { x: (j.pelvis.x + j.shoulders.x * 2) / 3, y: (j.pelvis.y + j.shoulders.y * 2) / 3 };
}

/** How far the spine is from upright, 0–180. */
function leanFromVertical(pose: Pose): number {
  return flexion(-90, pose.torso);
}

/** Every wheel centre the props drew — i.e. every real pulley. */
function pulleys(d: DemoVariant): Vec[] {
  const out: Vec[] = [];
  const re = /class="cd-frame cd-wheel" cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g;
  let m = re.exec(d.props());
  while (m) {
    out.push({ x: Number(m[1]), y: Number(m[2]) });
    m = re.exec(d.props());
  }
  return out;
}

/** Every vertical guide rail the props drew. */
function rails(d: DemoVariant): number[] {
  const out: number[] = [];
  const re = /class="cd-frame cd-rail" d="M (-?[\d.]+) /g;
  let m = re.exec(d.props());
  while (m) {
    out.push(Number(m[1]));
    m = re.exec(d.props());
  }
  return out;
}

/** Distance from a point to a segment — "does this bone cross the skull". */
function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

const eachFrame = (d: DemoVariant, fn: (j: Joints, pose: Pose, i: number) => void): void => {
  d.frames.forEach((pose, i) => fn(forwardKinematics(pose, d.view), pose, i));
};

/* ------------------------------------------------------------------ the sweep */

describe('coverage', () => {
  it('demonstrates every built-in exercise, exactly once, and nothing else', () => {
    const builtIn = builtInExercises().map((e) => e.id);
    expect(builtIn).toHaveLength(39);
    expect(EXERCISE_DEMOS.map((d) => d.id).sort()).toEqual([...builtIn].sort());
    expect(new Set(EXERCISE_DEMOS.map((d) => d.id)).size).toBe(EXERCISE_DEMOS.length);
    for (const d of EXERCISE_DEMOS) expect(findExercise(d.id)).not.toBeNull();
  });

  it('shows TWO ways of doing the exercises whose own name offers two', () => {
    // half the program's names are a choice — "פולי עליון / מתח", "חתירה
    // בסמית׳ / משקולות", "בתלייה או בשכיבה" — and a demo that silently picks one
    // teaches the wrong thing to whoever came for the other. These six get both,
    // side by side, in the order their own Hebrew name lists them.
    const pairs = EXERCISE_DEMOS.filter((d) => d.variants.length > 1);
    expect(pairs.map((d) => d.id)).toEqual(['a1', 'a6', 'b2', 'b4', 'c2', 'c5']);
    expect(pairs.map((d) => d.variants.map((v) => v.caption))).toEqual([
      ['סמית׳', 'משקולות'],
      ['בתלייה', 'בשכיבה'],
      ['פולי עליון', 'מתח'],
      ['סמית׳', 'משקולות'],
      ['משקולות', 'סמית׳'],
      ['על מזרן', 'בשיפוע'],
    ]);
    // …and nothing else carries a caption: with one picture the exercise's own
    // name is already the caption, and repeating it would be noise
    for (const d of EXERCISE_DEMOS) {
      if (d.variants.length === 1) expect(d.variants[0]?.caption, d.id).toBeUndefined();
      else for (const v of d.variants) expect(v.caption, d.id).toBeTruthy();
    }
    expect(ALL).toHaveLength(45);
    // two variants of one exercise are two DIFFERENT pictures, never a copy
    for (const d of EXERCISE_DEMOS) {
      if (d.variants.length < 2) continue;
      const [a, b] = d.variants as [DemoVariant, DemoVariant];
      expect(a.props(), d.id).not.toBe(b.props());
      expect(JSON.stringify(a.frames), d.id).not.toBe(JSON.stringify(b.frames));
    }
  });

  it('has NO demo for a custom exercise — a stand-in would be a guess', () => {
    expect(demoFor('cx_9f2a')).toBeNull();
    expect(demoFor('')).toBeNull();
    expect(demoFor('a1x')).toBeNull();
  });
});

describe('every demo, structurally', () => {
  for (const { tag, id, vi, v: d } of ALL) {
    describe(tag, () => {
      it('has 2–3 keyframes and a rep tempo a human could follow', () => {
        expect(d.frames.length).toBeGreaterThanOrEqual(2);
        expect(d.frames.length).toBeLessThanOrEqual(3);
        expect(d.loopMs).toBeGreaterThanOrEqual(1800);
        expect(d.loopMs).toBeLessThanOrEqual(5000);
        expect(['side', 'front', 'threeQuarter']).toContain(d.view);
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
          const a = frameOf(id, i - 1, vi);
          const b = frameOf(id, i, vi);
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
        if (d.hold.k === 'rope' || d.hold.k === 'handle' || d.hold.k === 'handleNear') {
          const from = { x: d.hold.from[0] ?? 0, y: d.hold.from[1] ?? 0 };
          expect(wheels.some((w) => dist(w, from) < 0.001)).toBe(true);
        }
        if (d.hold.k === 'cables') {
          for (const f of d.hold.from) {
            expect(wheels.some((w) => dist(w, { x: f[0] ?? 0, y: f[1] ?? 0 }) < 0.001)).toBe(true);
          }
        }
      });

      it('renders self-contained markup', () => {
        const svg = demoSvg(d, stillPose(d), 'x');
        expect(svg).toMatch(/^<svg class="cd-svg"/);
        expect(svg).toContain('cd-static');
        expect(svg).toContain('cd-live');
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
        // the licence story in one assertion: nothing is fetched, ever
        expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
        expect(svg).not.toMatch(/<image|url\(|xlink:href|\.gif|\.png|\.jpg|data:/);
      });

      it('actually MOVES — no demo is two copies of one pose', () => {
        // b5 is a HOLD: it breathes rather than reps, and that is the point.
        const least = id === 'b5' ? 0.4 : 3;
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
  for (const id of ['a1', 'b1', 'c1', 'c3', 'x12']) {
    it(id, () => {
      const last = endOf(id);
      const bottom = at(id, 0);
      const top = at(id, last);
      // bottom: the hand is ABOVE the chest (never down at the belly) and near it
      expect(bottom.near.grip.y).toBeLessThan(chest(bottom).y);
      expect(dist(bottom.near.shoulder, bottom.near.grip)).toBeLessThan(17);
      expect(flexion(frameOf(id, 0).arm[0], frameOf(id, 0).arm[1])).toBeGreaterThan(90);
      // top: pressed away, arm close to straight but not locked
      expect(dist(top.near.shoulder, top.near.grip)).toBeGreaterThan(22);
      expect(flexion(frameOf(id, last).arm[0], frameOf(id, last).arm[1])).toBeLessThan(60);
      expect(top.near.grip.y).toBeLessThan(bottom.near.grip.y - 12);
    });
  }

  it('a1 presses on a 30° incline, c1 on the same incline but DEEPER', () => {
    // both recline; c1's bottom sits closer to the shoulder than the bar allows
    expect(leanFromVertical(frameOf('a1', 0))).toBeCloseTo(60, 0);
    expect(leanFromVertical(frameOf('c1', 0))).toBeCloseTo(60, 0);
    const a1 = at('a1', 0);
    const c1 = at('c1', 0);
    // a1 is the RAIL and c1 the dumbbells: the bar stops at the chest, the
    // dumbbells go past it, so c1's bottom sits further from the shoulder
    expect(dist(c1.near.shoulder, c1.near.grip)).toBeGreaterThan(dist(a1.near.shoulder, a1.near.grip) + 3);
  });
});

describe('Smith machine lifts — the bar cannot leave the rail', () => {
  const cases: Array<[string, 'grip' | 'shoulder']> = [
    ['a1', 'grip'],
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
  for (const id of ['a3', 'x1', 'x11']) {
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
    const bottom = frameOf('c2', 1);
    expect(leanFromVertical(bottom) - leanFromVertical(top)).toBeGreaterThan(60);
    expect(flexion(top.leg[0], top.leg[1])).toBeLessThan(35);
    expect(flexion(bottom.leg[0], bottom.leg[1])).toBeLessThan(35);
  });

  it('pushes the hips BACK and lets the weight hang down the shins', () => {
    const a = at('c2', 0);
    const b = at('c2', 1);
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

  it('b2’s pull-up keeps the grip ON the bar and lifts the BODY to it', () => {
    const hang = at('b2', 0, 1);
    const top = at('b2', endOf('b2', 1), 1);
    expect(dist(hang.near.grip, top.near.grip)).toBeLessThan(1);
    expect(hang.pelvis.y - top.pelvis.y).toBeGreaterThan(15);
    expect(top.head.y).toBeLessThan(hang.head.y - 12); // chin arrives at the bar
  });

  it('b2’s LAT PULLDOWN is the other half of its own name, and it comes first', () => {
    // "פולי עליון / מתח" names the machine first, so the drawer leads with it
    const d = exercise('b2');
    expect(d.variants).toHaveLength(2);
    expect(d.variants[0]?.caption).toBe('פולי עליון');
    expect(d.variants[1]?.caption).toBe('מתח');

    const pd = demo('b2', 0);
    expect(pd.hold).toEqual({ k: 'handle', from: [78, 14], wide: true });
    const over = at('b2', 0, 0);
    const chestHigh = at('b2', endOf('b2', 0), 0);
    // seated: the pelvis never moves, unlike the pull-up where it is the point
    for (let i = 0; i <= endOf('b2', 0); i++) {
      expect(at('b2', i, 0).pelvis).toEqual(over.pelvis);
    }
    // the bar starts OVERHEAD, well above the head, arms all but straight
    expect(over.near.grip.y).toBeLessThan(over.head.y - 12);
    expect(dist(over.near.shoulder, over.near.grip)).toBeGreaterThan(26);
    // …and finishes at the UPPER CHEST: below the shoulder, well above the belly
    expect(chestHigh.near.grip.y).toBeGreaterThan(chestHigh.near.shoulder.y);
    expect(chestHigh.near.grip.y).toBeLessThan(chestHigh.pelvis.y - 15);
    // the elbow leads it, which is our own step ('הובילו את המרפקים מטה ולאחור'):
    // above the shoulder at the top, straight under it at the end
    expect(over.near.elbow.y).toBeLessThan(over.near.shoulder.y - 8);
    expect(chestHigh.near.elbow.y).toBeGreaterThan(chestHigh.near.shoulder.y + 8);
    expect(Math.abs(chestHigh.near.elbow.x - chestHigh.near.shoulder.x)).toBeLessThan(3);
    // the cable starts at a pulley that exists, and it hangs over the bar
    const wheel = pulleys(pd)[0] as Vec;
    expect(wheel).toEqual({ x: 78, y: 14 });
    // …and the bar travels STRAIGHT DOWN that pulley's line, not on an arc
    for (let i = 0; i <= 40; i++) {
      expect(Math.abs(tween(pd, i / 40).near.grip.x - wheel.x), `at ${i}`).toBeLessThan(2.5);
    }
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

  it('c5 carries the plate ON THE CHEST, and it rides the torso through the curl', () => {
    // our own step says 'משקל קל על החזה'; the first pass held it out past the
    // knees at arm's length, which is a different exercise.
    const d = demo('c5');
    expect(d.hold.k).toBe('plate');
    for (let i = 0; i <= endOf('c5'); i++) {
      const j = at('c5', i);
      const plate = holdAnchors(d.hold, j)[0] as Vec;
      // ON the chest: a hand's width off the sternum, never at arm's length
      expect(dist(plate, chest(j)), `frame ${i}`).toBeLessThan(10);
      // …and between the two ends of the torso, not out past the knees
      const along =
        ((plate.x - j.pelvis.x) * (j.shoulders.x - j.pelvis.x) +
          (plate.y - j.pelvis.y) * (j.shoulders.y - j.pelvis.y)) /
        dist(j.pelvis, j.shoulders);
      expect(along, `frame ${i}`).toBeGreaterThan(8);
      expect(along, `frame ${i}`).toBeLessThan(dist(j.pelvis, j.shoulders));
      expect(plate.x, `frame ${i}`).toBeGreaterThan(j.near.knee.x + 8); // never past the knees
      // the arms are FOLDED to put it there, and the elbows clear the skull
      expect(flexion(frameOf('c5', i).arm[0], frameOf('c5', i).arm[1])).toBeGreaterThan(100);
      expect(dist(j.near.elbow, j.head), `elbow ${i}`).toBeGreaterThan(7);
    }
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
    expect((right?.x ?? 0) - (left?.x ?? 0)).toBeGreaterThan(25);
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

  it('x7 is OUR face pull: two rope ends, two temples, elbows wide and high', () => {
    const d = demo('x7');
    // a rope has two ends and they arrive apart. The side camera stacks them;
    // the front camera separates them but has to hang the cable from the ceiling
    // and works the whole movement straight at the lens. The turned view keeps
    // the station where a face pull's station is — off to one side at head
    // height — and still shows two hands.
    expect(d.view).toBe('threeQuarter');
    const out = at('x7', 0);
    const pulled = at('x7', endOf('x7'));
    // extended: the fists out at the rope, the near arm all but straight
    expect(dist(out.near.shoulder, out.near.grip)).toBeGreaterThan(26);
    expect(out.near.grip.x).toBeGreaterThan(out.head.x + 20);
    // contracted: ONE FIST EITHER SIDE OF THE HEAD, at about eye height
    expect(pulled.near.grip.x).toBeGreaterThan(pulled.head.x + 8);
    expect(pulled.far.grip.x).toBeLessThan(pulled.head.x - 8);
    for (const g of [pulled.near.grip, pulled.far.grip]) {
      expect(Math.abs(g.y - pulled.head.y)).toBeLessThan(8);
      expect(dist(g, pulled.head)).toBeGreaterThan(9); // outside the skull
    }
    // …and the two are offset on the DEPTH diagonal, so which is which is never
    // in doubt: the far fist is the higher one
    expect(pulled.near.grip.y - pulled.far.grip.y).toBeGreaterThan(2);
    // ELBOWS WIDE AND HIGH is the cue, and both of them show it
    expect(pulled.near.elbow.x).toBeGreaterThan(pulled.near.shoulder.x + 8);
    expect(pulled.far.elbow.x).toBeLessThan(pulled.far.shoulder.x - 8);
    expect(pulled.near.elbow.y).toBeLessThan(pulled.near.shoulder.y);
    expect(pulled.far.elbow.y).toBeLessThan(pulled.far.shoulder.y);
    // the wheel is at FACE height and off to the side, which is where a cable
    // station is — not on the ceiling
    const wheel = pulleys(d)[0] as Vec;
    expect(Math.abs(wheel.y - out.head.y)).toBeLessThan(6);
    expect(wheel.x).toBeGreaterThan(out.head.x + 40);
    expect(d.hold.k === 'rope' && d.hold.from[0] === wheel.x && d.hold.from[1] === wheel.y).toBe(true);
  });

  it('x7 never draws anything ACROSS the face', () => {
    // the review's complaint about the front-view attempt was that the arm and
    // the rope read as piercing the skull. What is painted IN FRONT of the body
    // — the near arm, the cable, the clip, the near rope end — now misses the
    // head by more than its own radius all the way through the rep, and the far
    // halves that do cross it are painted BEHIND the figure.
    const d = demo('x7');
    const wheel = pulleys(d)[0] as Vec;
    for (let i = 0; i <= 40; i++) {
      const j = tween(d, i / 40);
      const bones: Array<[Vec, Vec]> = [
        [j.near.shoulder, j.near.elbow],
        [j.near.elbow, j.near.wrist],
        [j.near.wrist, j.near.grip],
      ];
      for (const [a, b] of bones) {
        expect(segDist(j.head, a, b), `near arm at ${i}`).toBeGreaterThan(8);
      }
      const hands = { x: (j.near.grip.x + j.far.grip.x) / 2, y: (j.near.grip.y + j.far.grip.y) / 2 };
      const a = angleOf(hands, wheel) * (Math.PI / 180);
      const clip = { x: hands.x + Math.cos(a) * 7, y: hands.y + Math.sin(a) * 7 };
      expect(dist(j.head, clip), `clip at ${i}`).toBeGreaterThan(7);
      expect(segDist(j.head, wheel, clip), `cable at ${i}`).toBeGreaterThan(8);
      expect(segDist(j.head, clip, j.near.grip), `near rope end at ${i}`).toBeGreaterThan(8);
    }
    // …and the far end really is in the back layer, not the front one
    const joints = forwardKinematics(frameAt(d.frames, 1), d.view);
    expect(holdBackSvg(d.hold, joints)).toContain('cd-rope');
    expect(holdSvg(d.hold, joints).match(/class="cd-rope"/g)).toHaveLength(1);
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
  it('a4 opens the hands to BOTH sides and closes them over the chest', () => {
    const d = demo('a4');
    // Seen from the side, two arms opening left and right stack into one plane
    // and the pair reads as one hand. Seen from straight above, the body is a
    // plank with a head on it. The TURNED view gives both: the bench recedes on
    // a diagonal and the two arms separate along that diagonal — the near one
    // swinging down towards the viewer, the far one up and away.
    expect(d.view).toBe('threeQuarter');
    const open = at('a4', 0);
    const closed = at('a4', endOf('a4'));
    expect(dist(open.near.grip, open.far.grip)).toBeGreaterThan(50);
    expect(open.near.grip.y - open.far.grip.y).toBeGreaterThan(50); // a wide V
    expect(dist(closed.near.grip, closed.far.grip)).toBeLessThan(8);
    for (let i = 0; i <= endOf('a4'); i++) {
      const j = at('a4', i);
      // one hand each side of the body's own depth line, the whole way: the near
      // one always lower in the picture, which is what "nearer the camera" looks
      // like in this projection. They converge but never swap.
      expect(j.near.grip.y, `frame ${i}`).toBeGreaterThan(j.far.grip.y + 1.5);
      // the elbow never straightens and never folds shut — "hug a wide tree",
      // not a press
      const p = frameOf('a4', i);
      for (const arm of [p.arm, p.armF] as const) {
        expect(flexion(arm[0], arm[1]), `elbow ${i}`).toBeGreaterThan(25);
        expect(flexion(arm[0], arm[1]), `elbow ${i}`).toBeLessThan(125);
      }
      // …and the two elbows bow the same anatomical way. See the chapter below.
      // …and the near elbow stays OUT, clear of the torso it would otherwise
      // vanish into
      expect(dist(j.near.elbow, j.shoulders), `elbow out ${i}`).toBeGreaterThan(14);
      // nothing tangles with the skull: both arms work on the FOOT side of it
      for (const side of [j.near, j.far]) {
        const bones: Array<[Vec, Vec]> = [
          [side.shoulder, side.elbow],
          [side.elbow, side.wrist],
          [side.wrist, side.grip],
        ];
        for (const [a, b] of bones) {
          expect(segDist(j.head, a, b), `head clearance ${i}`).toBeGreaterThan(9);
        }
      }
    }
    // the hands finish over the chest — off the body on the camera side of it,
    // not resting on the ribs
    const chestPt = chest(closed);
    expect(dist(closed.near.grip, chestPt)).toBeLessThan(18);
    expect(closed.near.grip.y).toBeLessThan(chestPt.y);
    // the bench is drawn on the same diagonal, as a surface rather than a pad
    expect(d.props()).toContain('cd-slab');
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
    const bottom = at('b3', endOf('b3'));
    expect(dist(top.near.grip, bottom.near.grip)).toBeLessThan(1); // hands on the bars
    expect(bottom.pelvis.y - top.pelvis.y).toBeGreaterThan(12);
    for (let i = 0; i <= endOf('b3'); i++) {
      const lean = leanFromVertical(frameOf('b3', i));
      expect(lean).toBeGreaterThan(25);
      expect(lean).toBeLessThan(40);
    }
  });

  it('b3 tucks the SHINS BEHIND the body, which is the way a dip is held', () => {
    // this figure leans over its hands and therefore faces +x: the knee bends to
    // a right angle and points down and FORWARD, and the shin sweeps BACK, so
    // the toe ends up well behind the knee. Forward-hanging shins were the
    // review's complaint and are what this measures.
    for (let i = 0; i <= endOf('b3'); i++) {
      const j = at('b3', i);
      for (const s of [j.near, j.far]) {
        expect(s.knee.x, `knee ${i}`).toBeGreaterThan(s.hip.x + 4); // knee forward
        expect(s.knee.y, `knee ${i}`).toBeGreaterThan(s.hip.y + 8); // …and down
        expect(s.ankle.x, `ankle ${i}`).toBeLessThan(s.knee.x - 8); // shin swept back
        expect(s.toe.x, `toe ${i}`).toBeLessThan(s.knee.x - 15);    // foot behind it
      }
      // …and the fold at the knee is a right angle, not a hang
      const p = frameOf('b3', i);
      expect(flexion(p.leg[0], p.leg[1])).toBeGreaterThan(70);
      expect(flexion(p.leg[0], p.leg[1])).toBeLessThan(110);
    }
  });

  it('c3 presses from ear height to overhead, seated and upright', () => {
    const ears = at('c3', 0);
    const up = at('c3', endOf('c3'));
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

describe('the 4-day plan library additions', () => {
  it('x11 squats with the bell held ON the chest the whole way down', () => {
    const d = demo('x11');
    expect(d.hold.k).toBe('plate');
    for (let i = 0; i <= endOf('x11'); i++) {
      const j = at('x11', i);
      const plate = holdAnchors(d.hold, j)[0] as Vec;
      // a fist's reach off the sternum, never pressed out or dropped
      expect(dist(plate, chest(j)), `frame ${i}`).toBeLessThan(12);
      expect(plate.x, `frame ${i}`).toBeGreaterThan(chest(j).x); // in FRONT of it
    }
  });

  it('x12 is b1’s straight-up press with dumbbells instead of the rail', () => {
    expect(demo('x12').frames).toEqual(demo('b1').frames);
    expect(demo('x12').hold).toEqual({ k: 'db' });
    expect(demo('x12').props()).not.toContain('cd-rail');
  });

  it('x13 is a passive hang: fists and shoulder pinned, everything below sinks', () => {
    const d = demo('x13');
    const a = at('x13', 0);
    const b = at('x13', 1);
    expect(dist(a.near.grip, b.near.grip)).toBeLessThan(0.5);
    expect(dist(a.near.shoulder, b.near.shoulder)).toBeLessThan(0.5);
    // the spine lets go: pelvis, knees and the settling skull all drop
    expect(b.pelvis.y - a.pelvis.y).toBeGreaterThan(3);
    expect(b.near.knee.y - a.near.knee.y).toBeGreaterThan(3);
    expect(b.head.y - a.head.y).toBeGreaterThan(3);
    // …and the drop is the shrug being released, not the hands slipping
    expect((frameOf('x13', 1).shrug ?? 0) - (frameOf('x13', 0).shrug ?? 0)).toBeGreaterThan(3);
    expect(d.loopMs).toBeGreaterThan(4000); // a hold breathes slower than a rep
  });

  it('x14 and x17 are b2’s pull-up, taught at the two assisted tempos', () => {
    // the assisted pull-up climbs the same path, slow both ways
    expect(demo('x14').frames).toEqual(demo('b2', 1).frames);
    expect(demo('x14').forwardShare).toBe(0.5);
    // the negative runs it top -> hang, and the descent owns the clock
    expect(demo('x17').frames).toEqual([...demo('b2', 1).frames].reverse());
    expect(demo('x17').forwardShare).toBeGreaterThan(0.6);
  });

  it('x15 rows the handle to the belly with the torso held still', () => {
    const a = frameOf('x15', 0);
    const b = frameOf('x15', 1);
    expect(b.torso).toBe(a.torso); // chest out, no body english
    expect(b.leg).toEqual(a.leg); // braced on the footplate
    const out = at('x15', 0);
    const pulled = at('x15', 1);
    expect(out.near.grip.x - pulled.near.grip.x).toBeGreaterThan(18);
    expect(pulled.near.elbow.x).toBeLessThan(pulled.near.shoulder.x); // elbow driven back
    expect(pulled.near.grip.y).toBeGreaterThan(pulled.near.shoulder.y + 4); // at the belly
    expect(demo('x15').hold).toEqual({ k: 'handle', from: [116, 74] });
  });

  it('x16 presses down the midline while the body refuses to turn', () => {
    const d = demo('x16');
    expect(d.view).toBe('front');
    const a = frameOf('x16', 0);
    const b = frameOf('x16', 1);
    // the entire point of the lift: only the arms move
    expect(b.torso).toBe(a.torso);
    expect(b.leg).toEqual(a.leg);
    expect(b.legF).toEqual(a.legF);
    expect(b.x).toBe(a.x);
    for (let i = 0; i <= endOf('x16'); i++) {
      const j = at('x16', i);
      const hands = holdAnchors(d.hold, j)[0] as Vec;
      expect(Math.abs(hands.x - j.pelvis.x), `frame ${i}`).toBeLessThan(1.5); // on the midline
    }
    const held = holdAnchors(d.hold, at('x16', 0))[0] as Vec;
    const pressed = holdAnchors(d.hold, at('x16', 1))[0] as Vec;
    expect(pressed.y - held.y).toBeGreaterThan(15);
    expect(d.hold).toEqual({ k: 'handle', from: [24, 50] });
  });

  it('x18 rows off the pad: the bench holds the hinge b4 has to', () => {
    const a = frameOf('x18', 0);
    const b = frameOf('x18', 1);
    expect(b.torso).toBe(a.torso); // the chest never leaves the pad
    expect(b.leg).toEqual(a.leg);
    const hang = at('x18', 0);
    const top = at('x18', 1);
    expect(hang.near.grip.y - top.near.grip.y).toBeGreaterThan(14);
    expect(top.near.elbow.x).toBeLessThan(top.near.shoulder.x); // elbow past the ribs
    expect(demo('x18').hold).toEqual({ k: 'db' });
    expect(demo('x18').props()).toContain('cd-pad');
  });

  it('x19 is b2’s pulldown with the shoulder-width bar', () => {
    expect(demo('x19').frames).toEqual(demo('b2', 0).frames);
    expect(demo('x19').hold).toEqual({ k: 'handle', from: [78, 14] }); // not wide
  });

  it('x20 rows one arm on the cable while the support side just holds', () => {
    const a = frameOf('x20', 0);
    const b = frameOf('x20', 1);
    expect(b.armF).toEqual(a.armF); // the bracing hand never moves
    expect(b.leg).toEqual(a.leg);
    expect(b.legF).toEqual(a.legF);
    expect(b.torso).toBe(a.torso);
    const out = at('x20', 0);
    const pulled = at('x20', 1);
    expect(out.near.grip.x - pulled.near.grip.x).toBeGreaterThan(18);
    expect(pulled.near.elbow.x).toBeLessThan(pulled.near.shoulder.x); // elbow driven back
    expect(demo('x20').hold).toEqual({ k: 'handleNear', from: [118, 58] });
  });
});

/* ------------------------------------------------------------ the treadmill */

/** The belt the treadmill prop drew, read back off the markup. */
function belt(d: DemoVariant): { x1: number; y1: number; x2: number; y2: number; at: (x: number) => number } {
  const m = /class="cd-pad cd-belt" d="M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)"/.exec(d.props());
  if (!m) throw new Error('no belt');
  const b = { x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) };
  return { ...b, at: (x) => b.y1 + ((b.y2 - b.y1) * (x - b.x1)) / (b.x2 - b.x1) };
}

describe('x21 — the treadmill walk climbs its deck', () => {
  it('walks on a belt that actually climbs, holding nothing', () => {
    const d = demo('x21');
    const b = belt(d);
    // an 8° rise to the right — a real 6% incline reads as flat at this size
    expect(b.x2).toBeGreaterThan(b.x1 + 60);
    expect(b.y1 - b.y2).toBeGreaterThan(8);
    expect(b.y1 - b.y2).toBeLessThan(20);
    expect(d.hold).toEqual({ k: 'none' });
    expect(d.view).toBe('side');
  });

  it('plants the leading foot ALONG the belt and lifts only the trailing heel', () => {
    const d = demo('x21');
    const b = belt(d);
    eachFrame(d, (j) => {
      const feet = [j.near, j.far];
      // the leading foot is the one further up the deck; it is flat on it
      const lead = feet.reduce((p, q) => (q.ankle.x > p.ankle.x ? q : p));
      const trail = lead === j.near ? j.far : j.near;
      expect(Math.abs(lead.ankle.y - b.at(lead.ankle.x))).toBeLessThan(1.5);
      expect(Math.abs(lead.toe.y - b.at(lead.toe.x))).toBeLessThan(1.5);
      // the trailing foot pushes off: heel clearly up, toe still on the belt
      expect(b.at(trail.ankle.x) - trail.ankle.y).toBeGreaterThan(1.5);
      expect(Math.abs(trail.toe.y - b.at(trail.toe.x))).toBeLessThan(1.5);
      // and nothing ever sinks through the deck
      for (const s of feet) {
        expect(s.ankle.y).toBeLessThan(b.at(s.ankle.x) + 1.5);
        expect(s.toe.y).toBeLessThan(b.at(s.toe.x) + 1.5);
      }
    });
  });

  it('strides — the legs alternate, the arms swing against them, the pelvis stays put', () => {
    const a = at('x21', 0);
    const c = at('x21', 1);
    // frame 0 leads with the near leg, frame 1 with the far one
    expect(a.near.ankle.x - a.far.ankle.x).toBeGreaterThan(12);
    expect(c.far.ankle.x - c.near.ankle.x).toBeGreaterThan(9);
    // the arm on the leading leg's side is the one swung BACK
    expect(a.near.grip.x).toBeLessThan(a.far.grip.x);
    expect(c.far.grip.x).toBeLessThan(c.near.grip.x);
    // in place: a treadmill moves the belt, not the walker
    expect(c.pelvis).toEqual(a.pelvis);
    // and the stride is a mirror, so the yoyo between the two IS the gait
    expect(frameOf('x21', 1).leg).toEqual(frameOf('x21', 0).legF);
    expect(frameOf('x21', 1).legF).toEqual(frameOf('x21', 0).leg);
  });

  it('leans into the climb without folding over the console', () => {
    for (const pose of demo('x21').frames) {
      const lean = leanFromVertical(pose);
      expect(lean).toBeGreaterThan(4);
      expect(lean).toBeLessThan(15);
      expect(pose.torso).toBeGreaterThan(-90); // forward, i.e. towards the front of the deck
    }
  });
});

/* ------------------------------------------------------ the path of the load */

describe('the load travels a path, not a loop', () => {
  /**
   * A REP IS ONE WAY AND THEN THE OTHER, never a wobble in between.
   *
   * Two keyframes and a straight lerp do not guarantee that: the segment angles
   * interpolate independently, so a hand is steered by a shoulder turning at one
   * rate and a forearm turning at another, and the result is a small loop — the
   * press that reads as a circle, the bar that leaves its rail half way up, the
   * fist that slides four units along the pull-up bar. The cure is a THIRD
   * keyframe solved by inverse kinematics on the line the load should travel;
   * what proves it is sampling the movement between the keyframes rather than
   * only on them.
   */
  const trace = (d: DemoVariant, of: (j: Joints) => Vec, samples = 40): Vec[] => {
    const out: Vec[] = [];
    for (let i = 0; i <= samples; i++) out.push(of(tween(d, i / samples)));
    return out;
  };

  /** How far a traced point RETREATS along the chord from its start to its end. */
  const backtrack = (pts: readonly Vec[]): number => {
    const a = pts[0] as Vec;
    const b = pts[pts.length - 1] as Vec;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return 0;
    let worst = -Infinity;
    let back = 0;
    for (const p of pts) {
      const s = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
      if (s < worst) back += worst - s;
      else worst = s;
    }
    return back;
  };

  /** The furthest any sample strays from that same chord. */
  const bow = (pts: readonly Vec[]): number => {
    const a = pts[0] as Vec;
    const b = pts[pts.length - 1] as Vec;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return 0;
    let worst = 0;
    for (const p of pts) {
      const e = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (e > worst) worst = e;
    }
    return worst;
  };

  /**
   * What the eye follows in each demo: the load when there is one, and the joint
   * the movement is ABOUT when the load is the body itself. `null` skips — a
   * plank has no path, and a hold with a 1-unit travel has nothing to measure.
   */
  const BODYWEIGHT: Record<string, (j: Joints) => Vec> = {
    a6: (j) => j.near.knee,
    b2: (j) => j.head,
    b3: (j) => j.pelvis,
    x14: (j) => j.head,
    x17: (j) => j.head,
  };

  const guided = (id: string, d: DemoVariant): ((j: Joints) => Vec) | null => {
    if (d.hold.k === 'none') return BODYWEIGHT[id] ?? null;
    return (j) => holdAnchors(d.hold, j)[0] as Vec;
  };

  for (const { tag, id, v: d } of ALL) {
    it(`${tag} never doubles back`, () => {
      const of = guided(id, d);
      if (!of) return;
      const pts = trace(d, of);
      // below six units of travel there is no path to speak of, and a wobble
      // measured against a chord that short means nothing
      if (dist(pts[0] as Vec, pts[pts.length - 1] as Vec) < 6) return;
      // 3 units is a third of a fist: below that nothing is visible at any size
      expect(backtrack(pts), `${tag} load doubles back on itself`).toBeLessThan(3);
    });
  }

  it('keeps a guided bar ON its rail BETWEEN the keyframes, not only on them', () => {
    // the keyframes were always on the rail; what the middle keyframe buys is
    // the travel between them, and a Smith bar that bows four units off the
    // track is not a Smith bar
    const cases: Array<[string, (j: Joints) => Vec]> = [
      ['a1', (j) => j.near.grip],
      ['b1', (j) => j.near.grip],
      ['b4', (j) => j.near.grip],
      ['x1', (j) => j.near.shoulder],
    ];
    for (const [id, of] of cases) {
      const d = demo(id);
      const railX = rails(d)[0] ?? 0;
      for (let i = 0; i <= 40; i++) {
        expect(Math.abs(of(tween(d, i / 40)).x - railX), `${id} at ${i}`).toBeLessThan(2.5);
      }
    }
  });

  it('presses a free weight along a STRAIGHT line, not around a circle', () => {
    // an incline dumbbell press, a seated shoulder press: nothing guides these,
    // but they are still presses. Each was given a middle keyframe solved on the
    // chord between the two ends, which is the difference between 3–4 units of
    // bow (a visible arc) and 1 (a line).
    for (const id of ['c1', 'c3']) {
      const d = demo(id);
      for (const of of [(j: Joints) => j.near.grip, (j: Joints) => j.far.grip]) {
        expect(bow(trace(d, of)), `${id} bows off its line`).toBeLessThan(2.5);
      }
    }
  });

  it('welds a bodyweight grip to the bar it hangs from', () => {
    for (const [id, vi] of [['a6', 0], ['b2', 1], ['b3', 0], ['x13', 0], ['x14', 0], ['x17', 0]] as Array<[string, number]>) {
      const d = demo(id, vi);
      const first = tween(d, 0).near.grip;
      for (let i = 0; i <= 40; i++) {
        expect(dist(first, tween(d, i / 40).near.grip), `${id} hand slid at ${i}`).toBeLessThan(2.5);
      }
    }
  });

  it('a4 closes the flye monotonically — the dumbbells only ever converge', () => {
    // measured in the TURNED projection, where the two hands separate along the
    // depth diagonal rather than left and right: the gap is the distance between
    // the two bells as drawn, and a rep that read as the arms changing their
    // mind half way down would show up here as the gap growing again.
    const d = demo('a4');
    const gap: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const j = tween(d, i / 40);
      gap.push(dist(j.near.grip, j.far.grip));
    }
    for (let i = 1; i < gap.length; i++) {
      expect(gap[i] as number, `gap grew at ${i}`).toBeLessThan((gap[i - 1] as number) + 0.01);
    }
    expect(gap[0] as number).toBeGreaterThan(55);
    expect(gap[gap.length - 1] as number).toBeLessThan(6);
  });
});

/* --------------------------------------------- the two arms of a turned pose */

describe('a turned pose has two arms, and they agree with each other', () => {
  /**
   * WHICH WAY AN ELBOW BENDS is not something the rig can be trusted to get
   * right on the far side by itself. Its mirror reflects the far limb about the
   * PICTURE's vertical axis — correct for a lifter standing square to the
   * camera, wrong for one lying along a diagonal, whose sagittal plane projects
   * to a nearly horizontal line. Reflected about the wrong axis, the far elbow
   * kinks the opposite way from the near one and the arm reads as bent
   * backwards. That is what the review caught in the flye.
   *
   * `bow` is the measure: the cross product of an arm's shoulder→grip chord with
   * its shoulder→elbow vector, i.e. WHICH SIDE OF ITS OWN CHORD the elbow sits
   * on. Two arms that are mirror images in three dimensions have opposite bow
   * signs in the picture whenever they travel opposite ways across it — and the
   * sign is what matters, not the magnitude, because the far arm is drawn
   * shorter.
   */
  const bow = (s: SideJoints): number => {
    const cx = s.grip.x - s.shoulder.x;
    const cy = s.grip.y - s.shoulder.y;
    return cx * (s.elbow.y - s.shoulder.y) - cy * (s.elbow.x - s.shoulder.x);
  };

  const turned = ALL.filter((e) => e.v.view === 'threeQuarter');

  it('has exactly the two demos the turned view exists for', () => {
    expect(turned.map((e) => e.tag)).toEqual(['a4', 'x7']);
  });

  for (const { tag, v: d } of turned) {
    it(`${tag} bends its two elbows to opposite sides of their own chords`, () => {
      for (let i = 0; i <= 40; i++) {
        const j = tween(d, i / 40);
        const n = bow(j.near);
        const f = bow(j.far);
        // both arms are meaningfully bent — a straight arm has no side
        expect(Math.abs(n), `${tag} near elbow flat at ${i}`).toBeGreaterThan(40);
        expect(Math.abs(f), `${tag} far elbow flat at ${i}`).toBeGreaterThan(40);
        expect(Math.sign(n), `${tag} elbows bend the same way at ${i}`).not.toBe(Math.sign(f));
      }
    });

    it(`${tag} never snaps an elbow through straight`, () => {
      // an elbow that changes which side of its chord it is on has to pass
      // through dead straight to get there, and for one frame the arm reads as
      // hinging backwards
      const first = { n: 0, f: 0 };
      for (let i = 0; i <= 40; i++) {
        const j = tween(d, i / 40);
        const n = Math.sign(bow(j.near));
        const f = Math.sign(bow(j.far));
        if (i === 0) { first.n = n; first.f = f; }
        expect(n, `${tag} near elbow flipped at ${i}`).toBe(first.n);
        expect(f, `${tag} far elbow flipped at ${i}`).toBe(first.f);
        const p = frameAt(d.frames, i / 40);
        expect(flexion(p.arm[0], p.arm[1]), `${tag} near arm straightens at ${i}`).toBeGreaterThan(20);
        expect(flexion(p.armF[0], p.armF[1]), `${tag} far arm straightens at ${i}`).toBeGreaterThan(20);
      }
    });

    it(`${tag} keeps both fists off the skull at the keyframes`, () => {
      // between them a far hand may pass behind the head — it is drawn before
      // the head, so the skull covers it — but at the two poses the reader
      // actually looks at, both hands are in the open
      for (let i = 0; i < d.frames.length; i++) {
        const j = forwardKinematics(d.frames[i] as Pose, d.view);
        expect(dist(j.head, j.near.grip), `${tag} near fist, frame ${i}`).toBeGreaterThan(9);
        expect(dist(j.head, j.far.grip), `${tag} far fist, frame ${i}`).toBeGreaterThan(9);
      }
    });
  }
});

describe('the views are chosen per movement, not by habit', () => {
  it('puts the frontal-plane lifts in the FRONT view and everything else in the side', () => {
    const front = ALL.filter((e) => e.v.view === 'front').map((e) => e.tag).sort();
    expect(front).toEqual(['b6', 'c6', 'x16', 'x4', 'x8']);
    // a4 and x7 are TWO-SIDED movements too — the sagittal camera stacks their
    // two hands into one no matter what the angles say — but neither belongs
    // square-on either: a flye seen from straight above is a plank with a head,
    // and a face pull seen from the front has to hang its cable from the ceiling
    // and works straight at the lens. They are the turned view's whole reason
    // for existing.
    const quarter = ALL.filter((e) => e.v.view === 'threeQuarter').map((e) => e.tag).sort();
    expect(quarter).toEqual(['a4', 'x7']);
    // …and every one of them is a movement whose plane is frontal
    for (const id of front) expect(findExercise(id)).not.toBeNull();
  });
});
