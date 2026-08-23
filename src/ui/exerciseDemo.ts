/**
 * ui/exerciseDemo.ts — the looping exercise demonstration, mounted into the
 * workout card's "הסבר ודגשי ביצוע" drawer.
 *
 * WHY A rAF INTERPOLATOR AND NOT CSS. A pose is a dozen joint ANGLES, and the
 * shapes they produce (a thigh, a forearm, the dumbbell hanging off the wrist,
 * the pec patch riding the ribs) are recomputed from those angles by forward
 * kinematics. CSS keyframes can interpolate a transform per element, but nothing
 * in CSS can interpolate the INPUT of a geometry function — a bench press
 * animated as per-limb rotations would need one nested transform per bone and
 * would still leave the weight behind. So: lerp the pose, run FK, repaint. The
 * repaint is one `innerHTML` of a few kB at 30 fps, and only the moving group —
 * the bench, the rail, the pulley and the load-path guide are painted once into
 * a sibling group and never touched again.
 *
 * THE TEMPO IS NOT SYMMETRIC. A rep's two halves take different times, so the
 * loop is split at `forwardShare`: the forward pass of the keyframes gets that
 * fraction of the clock and the way back gets the rest, each eased on its own.
 * A press snaps up and lowers slowly; an RDL lowers slowly and drives up.
 *
 * WHEN IT MOVES, AND WHEN IT DOES NOT. The loop is decoration, so it gives up
 * easily and always leaves a correct still behind:
 *   - `prefers-reduced-motion: reduce` → the MID-REP pose, painted once. This is
 *     deliberately the middle and not the start: a still of half way down a
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

import { demoFor, type ExerciseDemo } from '../data/exercisePoses.ts';
import { esc } from './dom.ts';
import { ease, forwardKinematics, n, type Pose } from './coachFigure.ts';
import {
  MUSCLE_HE,
  defsSvg,
  figureSvg,
  frameAt,
  motionPathSvg,
  styleOf,
  type DemoLook,
} from './coachVolume.ts';

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
 * The pose `ms` into the loop. The same cosine ease as ever, but applied to each
 * half of the yoyo separately with its own share of the clock, which is the
 * cheapest honest tempo: the lift snaps, the lowering takes its time.
 */
export function poseAt(demo: ExerciseDemo, ms: number): Pose {
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
export function stillPose(demo: ExerciseDemo): Pose {
  return frameAt(demo.frames, 0.5);
}

/* ----------------------------------------------------------------- drawing */

/** The moving half of the picture: the figure, its muscle patch and its iron. */
export function liveSvg(demo: ExerciseDemo, pose: Pose): string {
  return figureSvg(forwardKinematics(pose, demo.view), styleOf(demo as DemoLook), clipIdOf(demo));
}

/**
 * The id of a demo's torso clip path. The clip is rebuilt on every repaint (the
 * torso deforms with the spine), so the mount has to hand the live group the
 * same id the first paint used.
 */
export function clipIdOf(demo: ExerciseDemo): string {
  return `cd-${demo.id}-torso`;
}

/** The complete markup of a demo at one pose — used by the mount and by tests. */
export function demoSvg(demo: ExerciseDemo, pose: Pose, label: string): string {
  const [x, y, w, h] = demo.camera;
  return (
    `<svg class="cd-svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="${esc(label)}" data-view="${demo.view}">` +
    defsSvg() +
    `<rect class="cd-bg" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#cdStage)"/>` +
    `<g class="cd-static">${demo.props()}${motionPathSvg(demo as DemoLook)}</g>` +
    `<g class="cd-live">${liveSvg(demo, pose)}</g>` +
    `</svg>`
  );
}

/** The legend chip: 🎯 plus the muscles this demo is highlighting. */
export function legendHtml(demo: ExerciseDemo): string {
  const names = demo.muscles.length > 0 ? demo.muscles : [MUSCLE_HE[demo.primary]];
  const main = names[0] ?? '';
  const rest = names.slice(1).join(' · ');
  return (
    `<p class="cd-legend"><span class="cd-chip">` +
    `<span aria-hidden="true">🎯</span><span>${esc(main)}</span>` +
    (rest ? `<span class="cd-chip-2">${esc(rest)}</span>` : '') +
    `</span></p>`
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

  const el = document.createElement('div');
  el.className = 'ex-demo';
  el.dataset['demo'] = demo.id;
  const label = opts.label ?? 'הדגמת ביצוע';
  const still = opts.still === true || !canAnimate();
  el.innerHTML = demoSvg(demo, stillPose(demo), label) + legendHtml(demo);
  host.appendChild(el);

  const live = el.querySelector<SVGGElement>('.cd-live');
  let raf = 0;
  let origin = 0;
  let painted = -1;
  let disposed = false;

  function paint(pose: Pose): void {
    if (live) live.innerHTML = liveSvg(demo as ExerciseDemo, pose);
  }

  function renderAt(ms: number): void {
    paint(poseAt(demo as ExerciseDemo, ms));
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
