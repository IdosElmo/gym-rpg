/**
 * ui/coachProps.ts — the station the demonstration happens on.
 *
 * ORIGINAL ART, authored from numbers here. A stick figure could stand on a
 * line and hold another line, and the eye filled in a gym. A volumetric coach
 * cannot: a solid body lying on a 2px stroke reads as a body floating over a
 * scratch. So every station in here is a SOLID — pads with thickness and a lit
 * top surface, posts with width, plate stacks with plates — drawn from the same
 * `capsule`/`inked` vocabulary as the figure so the two belong to one picture.
 *
 * NOTHING HERE MOVES. Props are painted once into their own group and never
 * touched again (`ui/exerciseDemo.ts`), which is why they are plain functions of
 * their placement and not of the pose.
 *
 * TWO MARKER CLASSES SURVIVE FOR THE TESTS, and they are the only ones:
 * `cd-rail` on a guided bar's travel line and `cd-wheel` on a pulley's wheel.
 * `tests/exercisePoses.test.ts` reads them back out of the markup to prove that
 * a Smith lift's bar really does stay on the rail the props drew, and that a
 * cable really does start at a pulley that exists — rather than at a number
 * someone typed twice.
 */

import { PAL, capsule, circ, ell, inked } from './coachVolume.ts';
import { STAGE, angleOf, n, step, type Vec } from './coachFigure.ts';

/** The floor: a band with a lit edge, so the figure stands ON something. */
export function floor(x1: number, x2: number, y: number = STAGE.floorY): string {
  return (
    `<rect x="${n(x1)}" y="${n(y)}" width="${n(x2 - x1)}" height="${n(STAGE.h - y)}" fill="${PAL.frameDark}" opacity=".55"/>` +
    `<path d="M ${n(x1)} ${n(y)} L ${n(x2)} ${n(y)}" stroke="${PAL.frame}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`
  );
}

/** The soft shadow a body throws on that floor. */
export function shadow(cx: number, rx: number, y: number = STAGE.floorY): string {
  return ell({ x: cx, y: y + 0.6 }, rx, 2.6, 0, PAL.ink, 'opacity=".45"');
}

/** One padded slab: `a`→`b` is its TOP surface, and it is `th` thick under it. */
export function padSlab(a: Vec, b: Vec, th: number): string {
  const ang = angleOf(a, b);
  const down = ang + 90;
  const r = th / 2;
  const ca = step(a, down, r);
  const cb = step(b, down, r);
  return (
    inked(capsule(ca, cb, r, r), PAL.pad, 1.3) +
    `<path d="${capsule(step(a, down, r * 0.55), step(b, down, r * 0.55), r * 0.42, r * 0.42)}" fill="${PAL.padLight}" opacity=".5"/>`
  );
}

/** A frame member: a solid post or strut of width `w`. */
export function strut(a: Vec, b: Vec, w = 3.2): string {
  return inked(capsule(a, b, w / 2, w / 2), PAL.frame, 1.2);
}

/** A post dropped from `p` to the floor. */
function post(p: Vec, floorY: number, w = 3.4): string {
  return strut({ x: p.x, y: p.y + 2 }, { x: p.x, y: floorY }, w);
}

/**
 * A FLAT BENCH. `(x, y)` is the head end of the pad, `len` its length running to
 * the right; a post under each end and a base on the floor, so it reads as a
 * bench rather than as a floating slab.
 */
export function flatBench(o: { x: number; y: number; len: number; floorY?: number }): string {
  const floorY = o.floorY ?? STAGE.floorY;
  const a: Vec = { x: o.x, y: o.y };
  const b: Vec = { x: o.x + o.len, y: o.y };
  return (
    strut({ x: a.x + 2, y: floorY - 1.4 }, { x: b.x - 2, y: floorY - 1.4 }, 3.4) +
    post({ x: a.x + 5, y: a.y }, floorY) +
    post({ x: b.x - 5, y: b.y }, floorY) +
    padSlab(a, b, 6.6)
  );
}

/**
 * AN INCLINE BENCH, drawn as a bench: a back pad on its rise, a seat pad at the
 * bottom of it, a post under each, and a base on the floor. `(x, y)` is the
 * HINGE — where the two pads meet — and `angle` the rise of the back pad.
 */
export function inclineBench(o: {
  x: number;
  y: number;
  len: number;
  angle: number;
  seat: number;
  floorY?: number;
}): string {
  const floorY = o.floorY ?? STAGE.floorY;
  const hinge: Vec = { x: o.x, y: o.y };
  const top = step(hinge, o.angle, o.len);
  const seatEnd: Vec = { x: o.x - o.seat, y: o.y + 1.2 };
  return (
    // base first, then the posts, then the pads on top of them
    strut({ x: seatEnd.x - 3, y: floorY - 1.4 }, { x: top.x + 2, y: floorY - 1.4 }, 3.4) +
    post({ x: seatEnd.x + 2, y: seatEnd.y }, floorY) +
    post({ x: top.x - 1.5, y: top.y }, floorY) +
    strut({ x: top.x - 1.5, y: top.y + 6 }, { x: hinge.x + 4, y: floorY - 2 }, 2.6) +
    padSlab(seatEnd, hinge, 6.4) +
    padSlab(hinge, top, 7.2)
  );
}

/**
 * A FLAT BENCH SEEN FROM ABOVE — the one station that is not a side elevation.
 *
 * A lifter lying face-up, viewed from directly overhead, is the FRONT
 * silhouette; the bench under them is therefore a slab running head-to-foot
 * rather than a pad on posts. `(x, y1)` is the head end and `(x, y2)` the foot
 * end; `half` is half the pad's width. The frame shows as two cross-members at
 * the ends, which is all you see of a bench's legs from above.
 */
export function benchTop(x: number, y1: number, y2: number, half = 9.5): string {
  const bar = (y: number, w: number): string =>
    strut({ x: x - w, y }, { x: x + w, y }, 3.4);
  return (
    bar(y1 + 3, half + 4) +
    bar(y2 - 3, half + 5) +
    inked(capsule({ x, y: y1 + half }, { x, y: y2 - half }, half, half), PAL.pad, 1.3) +
    // the lit centre of the pad, and the seam where the head cushion starts
    `<path d="${capsule({ x, y: y1 + half }, { x, y: y2 - half }, half * 0.42, half * 0.42)}" fill="${PAL.padLight}" opacity=".35"/>` +
    `<path d="${capsule({ x: x - half + 1, y: y1 + 8 }, { x: x + half - 1, y: y1 + 8 }, 0.7, 0.7)}" fill="${PAL.padDark}" opacity=".7"/>`
  );
}

/**
 * AN UPRIGHT BENCH — the near-vertical backrest a seated press or a seated
 * overhead extension is done against. Same parts as the incline, steeper, and
 * with the seat long enough for a thigh to actually sit on it.
 *
 * `seat` is SIGNED, and that is not fussiness: the seat has to run out from the
 * hinge in the direction the lifter is facing, and half these demos face the
 * other way. A positive seat extends to the right of `(x, y)`.
 */
export function uprightBench(o: {
  x: number;
  y: number;
  back: number;
  seat: number;
  angle?: number;
  floorY?: number;
}): string {
  const floorY = o.floorY ?? STAGE.floorY;
  const hinge: Vec = { x: o.x, y: o.y };
  const top = step(hinge, o.angle ?? -85, o.back);
  const seatEnd: Vec = { x: o.x + o.seat, y: o.y };
  const lo = Math.min(seatEnd.x, hinge.x);
  const hi = Math.max(seatEnd.x, hinge.x);
  return (
    strut({ x: lo - 2, y: floorY - 1.4 }, { x: hi + 3, y: floorY - 1.4 }, 3.4) +
    post({ x: seatEnd.x - Math.sign(o.seat) * 3, y: seatEnd.y }, floorY) +
    post({ x: hinge.x, y: hinge.y }, floorY) +
    padSlab(hinge, top, 6.4) +
    padSlab({ x: lo, y: o.y }, { x: hi, y: o.y }, 6.4)
  );
}

/**
 * A SMITH RAIL: the guided track a bar cannot leave, plus the catch pegs down
 * its length. The thin bright line down the middle is the GROOVE — and it is the
 * element the pose tests read the rail's x back out of, which is why it is drawn
 * as one straight `M x y1 L x y2`.
 */
export function rail(x: number, y1: number, y2: number): string {
  const pegs: string[] = [];
  for (let y = y1 + 10; y < y2 - 6; y += 11) {
    pegs.push(inked(capsule({ x: x + 1.6, y }, { x: x + 5.4, y }, 1.1, 0.9), PAL.frameDark, 1));
  }
  return (
    strut({ x, y: y1 }, { x, y: y2 }, 4.6) +
    `<path class="cd-rail" d="M ${n(x)} ${n(y1)} L ${n(x)} ${n(y2)}" stroke="${PAL.padLight}" stroke-width="1" opacity=".4" fill="none"/>` +
    pegs.join('')
  );
}

/**
 * A CABLE STATION: the upright, the wheel the cable leaves from and — when the
 * lift is heavy enough to want one — the plate stack under it. The wheel carries
 * `cd-wheel`, which is what proves a cable in the pose data starts somewhere
 * that actually exists.
 */
export function pulley(x: number, y: number, o: { top?: number; post?: number; stack?: boolean } = {}): string {
  const top = o.top ?? 8;
  const down = o.post ?? 40;
  const stack = o.stack === true
    ? inked(capsule({ x, y: y + 16 }, { x, y: y + down - 3 }, 6.2, 6.2), PAL.frameDark, 1.2) +
      [0, 1, 2, 3].map((i) =>
        inked(capsule({ x: x - 4.6, y: y + 20 + i * 5.4 }, { x: x + 4.6, y: y + 20 + i * 5.4 }, 2.1, 2.1), PAL.iron, 1),
      ).join('')
    : '';
  return (
    strut({ x, y: top }, { x, y: y + down }, 4.4) +
    stack +
    `<circle class="cd-wheel" cx="${n(x)}" cy="${n(y)}" r="3.8" fill="${PAL.iron}" stroke="${PAL.line}" stroke-width="1.2"/>` +
    circ({ x, y }, 1.4, PAL.plate, 'opacity=".8"')
  );
}

/** A pull-up / hanging bar, hung from the top of the stage. */
export function pullBar(x1: number, x2: number, y: number, top = 8): string {
  return (
    strut({ x: x1 + 3, y: top }, { x: x1 + 3, y }, 3.2) +
    strut({ x: x2 - 3, y: top }, { x: x2 - 3, y }, 3.2) +
    inked(capsule({ x: x1, y }, { x: x2, y }, 2.4, 2.4), PAL.iron, 1.2) +
    `<path d="${capsule({ x: x1 + 1, y: y - 0.9 }, { x: x2 - 1, y: y - 0.9 }, 0.6, 0.6)}" fill="${PAL.plate}" opacity=".45"/>`
  );
}

/** Parallel (dip) bars: the bar the hands sit on, on its uprights. */
export function dipBars(x1: number, x2: number, y: number, floorY: number = STAGE.floorY): string {
  return (
    strut({ x: x1 + 3, y }, { x: x1 + 3, y: floorY }, 3.6) +
    strut({ x: x2 - 3, y }, { x: x2 - 3, y: floorY }, 3.6) +
    strut({ x: x1 + 3, y: floorY - 2 }, { x: x2 - 3, y: floorY - 2 }, 3) +
    inked(capsule({ x: x1, y }, { x: x2, y }, 2.4, 2.4), PAL.iron, 1.2)
  );
}

/** A mat: the thin firm pad floor work happens on. */
export function mat(x1: number, x2: number, y: number): string {
  return (
    inked(capsule({ x: x1 + 2, y: y + 2 }, { x: x2 - 2, y: y + 2 }, 2.4, 2.4), PAL.padDark, 1.2) +
    `<path d="${capsule({ x: x1 + 3, y: y + 1.2 }, { x: x2 - 3, y: y + 1.2 }, 0.7, 0.7)}" fill="${PAL.padLight}" opacity=".45"/>`
  );
}

/** A machine's rotation axis, drawn where the joint it tracks actually sits. */
export function pivot(x: number, y: number): string {
  return (
    `<circle class="cd-pivot" cx="${n(x)}" cy="${n(y)}" r="4.2" fill="${PAL.frameDark}" stroke="${PAL.line}" stroke-width="1.2"/>` +
    circ({ x, y }, 1.5, PAL.padLight, 'opacity=".7"')
  );
}

/** The arm that carries a roller pad, from the machine's pivot out to the pad. */
export function rollerArm(from: Vec, to: Vec): string {
  return strut(from, to, 3);
}

/**
 * THE LEG EXTENSION STATION, built from its own parts rather than from a bench:
 * a seat that runs under the thighs to the pivot, a backrest set far enough back
 * to read behind the torso, and the pivot itself drawn ON the knee.
 */
export function legExtensionStation(floorY: number = STAGE.floorY): string {
  return (
    strut({ x: 48, y: 86 }, { x: 48, y: floorY }, 4) +
    strut({ x: 86, y: 86 }, { x: 86, y: floorY }, 4) +
    strut({ x: 48, y: floorY - 1.6 }, { x: 88, y: floorY - 1.6 }, 3.4) +
    strut({ x: 86, y: 84 }, { x: 86, y: 62 }, 4) +
    strut({ x: 81, y: 62 }, { x: 89, y: 62 }, 3.4) +
    padSlab({ x: 46, y: 84 }, { x: 86, y: 84 }, 6.2) +
    padSlab({ x: 60, y: 84 }, { x: 55, y: 58 }, 6.2) +
    pivot(83, 80)
  );
}

/**
 * THE LYING LEG CURL STATION: a long pad to lie face-down on, its frame, and the
 * pivot the shin rotates about at the knee end.
 */
export function legCurlStation(floorY: number = STAGE.floorY): string {
  return flatBench({ x: 40, y: 86, len: 66, floorY }) + pivot(101, 82);
}

/**
 * THE LAT PULLDOWN SEAT: a seat and the thigh pad that stops the lifter being
 * pulled out of it — the two parts that make the station recognisable.
 */
export function pulldownSeat(floorY: number = STAGE.floorY): string {
  return (
    strut({ x: 56, y: 86 }, { x: 56, y: floorY }, 4) +
    strut({ x: 56, y: floorY - 1.6 }, { x: 92, y: floorY - 1.6 }, 3.4) +
    padSlab({ x: 48, y: 86 }, { x: 70, y: 86 }, 6.2) +
    strut({ x: 80, y: 86 }, { x: 80, y: 74 }, 3.4) +
    padSlab({ x: 72, y: 74 }, { x: 92, y: 74 }, 6)
  );
}
