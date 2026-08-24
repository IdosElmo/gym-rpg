/**
 * ui/exerciseDemo.ts — the looping exercise demonstration, mounted into the
 * workout card's "הסבר ודגשי ביצוע" drawer.
 *
 * WHY A rAF INTERPOLATOR AND NOT CSS. A pose is a dozen joint ANGLES, and the
 * shapes they produce (a thigh, a forearm, the dumbbell hanging off the wrist)
 * are recomputed from those angles by forward kinematics. CSS keyframes can
 * interpolate a transform per element, but nothing in CSS can interpolate the
 * INPUT of a geometry function — a bench press animated as per-limb rotations
 * would need one nested transform per bone and would still leave the weight
 * behind. So: lerp the pose, run FK, repaint. The repaint is one `innerHTML` of
 * a ~1 kB group at 30 fps, and only the moving group — the bench, the rail and
 * the pulley are painted once into a sibling group and never touched again.
 *
 * TWO STAGES, ONE CLOCK. An exercise whose own name offers two implementations
 * (`data/exercisePoses.ts`) is drawn as two pictures sharing the card's width,
 * each with its own caption — and BOTH are painted from the same `ms` inside the
 * same `requestAnimationFrame` callback. Two loops would be two things that
 * could drift apart, and one frame does the work of two anyway.
 *
 * THE TEMPO IS NOT SYMMETRIC. A rep's two halves take different times, so the
 * loop is split at `forwardShare`: the forward pass of the keyframes gets that
 * fraction of the clock and the way back gets the rest, each eased on its own.
 * A press snaps up and lowers slowly; an RDL lowers slowly and drives up.
 *
 * WHEN IT MOVES, AND WHEN IT DOES NOT. The loop is decoration, so it gives up
 * easily and always leaves a correct still behind:
 *   - `prefers-reduced-motion: reduce` → the mid-rep pose, painted once. This
 *     is deliberately a MID pose and not the start: a still of the bottom of a
 *     squat says more than a still of someone standing.
 *   - no `requestAnimationFrame` (jsdom, and any host without one) → the same
 *     still. There is no `setTimeout` fallback on purpose — unlike the battle
 *     loop, nothing here advances a simulation, so a demo that cannot animate
 *     smoothly is simply a diagram.
 *   - the panel is closed → the whole element is removed by the caller, which
 *     disposes the handle (`ui/workout.ts`).
 *   - the tab is hidden, or the element left the document → the loop parks
 *     itself. A card that is re-rendered under a running demo therefore stops
 *     on the next frame even if nobody called `destroy`.
 *
 * NO CLOCK OF ITS OWN. Time arrives as the `requestAnimationFrame` timestamp,
 * and `renderAt(ms)` paints any point of the loop directly, which is how the
 * tests inspect real frames without ever starting one.
 */

import { demoFor, type DemoVariant } from '../data/exercisePoses.ts';
import { esc } from './dom.ts';
import {
  ease,
  figureSvg,
  forwardKinematics,
  frameAt,
  holdBackSvg,
  holdSvg,
  STAGE,
  type Pose,
} from './coachFigure.ts';

/** Fastest repaint we ever ask for. A rep takes 2–4s; 30 fps is plenty. */
const FRAME_MS = 1000 / 30;

export interface DemoOptions {
  /** Accessible name; defaults to a generic Hebrew one. */
  readonly label?: string;
  /** Force the still (tests, and any caller that knows better). */
  readonly still?: boolean;
}

export interface DemoHandle {
  readonly el: HTMLElement;
  /** True while a frame is scheduled. Always false for a still. */
  running(): boolean;
  start(): void;
  stop(): void;
  /** Stop, then remove the element from the DOM. Safe to call twice. */
  destroy(): void;
  /** Paint the pose at `ms` into the loop. The tests' only clock. */
  renderAt(ms: number): void;
}

/* ------------------------------------------------------------------ timing */

/**
 * The pose `ms` into the loop (wrapping). The keyframes are played forwards and
 * then backwards — but NOT in equal time: `forwardShare` says how much of the
 * clock the forward pass gets, because a rep is not symmetric. A press whose
 * frames run bottom → top asks for less than half (it snaps up and lowers
 * slowly); a hinge whose frames run standing → bottom asks for more. Each half
 * is eased on its own, so the turn-around is still the slow part.
 */
export function poseAt(demo: DemoVariant, ms: number): Pose {
  const cycle = demo.loopMs > 0 ? demo.loopMs : 1;
  const t = (((ms % cycle) + cycle) % cycle) / cycle;
  const fs = Math.min(0.85, Math.max(0.15, demo.forwardShare));
  const u = t < fs ? ease(t / fs) : 1 - ease((t - fs) / (1 - fs));
  return frameAt(demo.frames, u);
}

/**
 * The pose a STILL shows: the middle of the authored pass, which is where a
 * movement is most itself — half way down the squat, the dumbbells level with
 * the chest, the twist at full turn.
 */
export function stillPose(demo: DemoVariant): Pose {
  return frameAt(demo.frames, 0.5);
}

/* ----------------------------------------------------------------- drawing */

/**
 * The moving half of the picture: the figure plus whatever it is holding — in
 * three layers, because a load is not always in front of the body. The far half
 * of a rope passes behind the head, and the head is a filled circle, so it has
 * to be painted before the figure or it draws a stripe across the face.
 */
export function liveSvg(demo: DemoVariant, pose: Pose): string {
  const joints = forwardKinematics(pose, demo.view);
  return holdBackSvg(demo.hold, joints) + figureSvg(joints, demo.view) + holdSvg(demo.hold, joints);
}

/** The complete markup of one variant at one pose — used by the mount and by tests. */
export function demoSvg(demo: DemoVariant, pose: Pose, label: string): string {
  return (
    `<svg class="cd-svg" viewBox="0 0 ${STAGE.w} ${STAGE.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label)}" data-view="${demo.view}">` +
    `<g class="cd-static">${demo.props()}</g>` +
    `<g class="cd-live">${liveSvg(demo, pose)}</g>` +
    `</svg>`
  );
}

/**
 * One stage: the picture, and — only when there is more than one — the little
 * Hebrew caption that says WHICH way of doing it this one is.
 */
export function stageHtml(v: DemoVariant, label: string): string {
  const name = v.caption ? `${label} · ${v.caption}` : label;
  return (
    `<div class="cd-stage">` +
    demoSvg(v, stillPose(v), name) +
    (v.caption ? `<p class="cd-cap">${esc(v.caption)}</p>` : '') +
    `</div>`
  );
}

/* ------------------------------------------------------------------- mount */

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function canAnimate(): boolean {
  return typeof requestAnimationFrame === 'function' && !prefersReducedMotion();
}

/**
 * Build the demo element for an exercise and append it to `host`.
 * Returns `null` — and touches nothing — when the exercise has no poses, which
 * is the whole story for a user's custom exercise.
 */
export function mountExerciseDemo(host: HTMLElement, exId: string, opts: DemoOptions = {}): DemoHandle | null {
  const demo = demoFor(exId);
  if (!demo) return null;

  const variants = demo.variants;
  const el = document.createElement('div');
  el.className = variants.length > 1 ? 'ex-demo ex-demo-pair' : 'ex-demo';
  el.dataset['demo'] = demo.id;
  const label = opts.label ?? 'הדגמת ביצוע';
  const still = opts.still === true || !canAnimate();
  el.innerHTML = variants.map((v) => stageHtml(v, label)).join('');
  host.appendChild(el);

  const lives = Array.from(el.querySelectorAll<SVGGElement>('.cd-live'));
  let raf = 0;
  let origin = 0;
  let painted = -1;
  let disposed = false;

  /**
   * ONE CLOCK FOR BOTH STAGES. Two variants are two pictures of one exercise, so
   * they are painted from the same `ms` by the same frame — never two loops that
   * could drift apart, and never two `requestAnimationFrame` chains where one
   * would do.
   */
  function renderAt(ms: number): void {
    for (let i = 0; i < lives.length; i++) {
      const v = variants[i];
      const g = lives[i];
      if (v && g) g.innerHTML = liveSvg(v, poseAt(v, ms));
    }
  }

  function frame(now: number): void {
    raf = 0;
    // A card that was re-rendered under us takes its element out of the
    // document: that is the signal to let go completely, listener and all, so
    // a screen change can never leave a demo (or a listener) behind.
    if (disposed) return;
    if (!el.isConnected) {
      destroy();
      return;
    }
    if (document.visibilityState === 'hidden') return;
    if (origin === 0) origin = now;
    const ms = now - origin;
    if (painted < 0 || ms - painted >= FRAME_MS) {
      painted = ms;
      renderAt(ms);
    }
    schedule();
  }

  function schedule(): void {
    if (disposed || raf !== 0 || still) return;
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
  }

  function start(): void {
    if (disposed || still) return;
    // A pause never banks time: pick the clock up again on the next frame.
    origin = 0;
    painted = -1;
    schedule();
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') stop();
    else start();
  }

  function destroy(): void {
    if (disposed) return;
    disposed = true;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    el.remove();
  }

  if (!still) {
    document.addEventListener('visibilitychange', onVisibility);
    start();
  }

  return { el, running: () => raf !== 0, start, stop, destroy, renderAt };
}
