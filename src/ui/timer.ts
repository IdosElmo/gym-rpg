/**
 * ui/timer.ts — the floating rest timer.
 *
 * Behaviour is a faithful port of the legacy implementation:
 *   - auto-starts when a set is checked, with the exercise name as the label;
 *   - +15s / −15s / pause-resume / reset / close;
 *   - drift-corrected countdown: it ticks every 500ms but subtracts the REAL
 *     elapsed time from `Date.now()` deltas, so a backgrounded tab or a slow
 *     frame never makes the timer lag;
 *   - progress bar across the top, 5× flash animation on completion;
 *   - Web Audio synthesized 3-note arpeggio (880 / 1108.7 / 1318.5 Hz) — no
 *     audio files, nothing fetched;
 *   - vibration pattern, and an audio-context unlock on the first touch/click
 *     (mobile autoplay requirement).
 *
 * …plus three things that port got wrong on a real phone, all three reported
 * from the same set of screenshots (a bar stuck at "0:00 · המשך" over the
 * character screen's stat tiles):
 *   - it AUTO-HIDES {@link AUTO_HIDE_MS} after the countdown ends, so a bar
 *     nobody closed stops floating over the next screen forever. Touching it
 *     cancels that outright — if the player is still using it, it stays;
 *   - it toggles `body.timer-open`, which is what reserves the bottom room
 *     under EVERY screen (the legacy padding was a constant that only ever
 *     matched the workout screen — see `styles/base.css`);
 *   - in the finished state there is nothing to CONTINUE, so the pause control
 *     leaves the row instead of offering "המשך" over a 0:00 clock. איפוס and ✕
 *     stay, because both still do something.
 * None of it animates anything new, so `prefers-reduced-motion` needs no
 * special case: hiding rides the same transform transition the global rule
 * already switches off, and a bar that vanishes instantly is exactly right.
 */

interface TimerElements {
  bar: HTMLElement;
  time: HTMLElement;
  prog: HTMLElement;
  title: HTMLElement;
  plus: HTMLElement;
  minus: HTMLElement;
  pause: HTMLElement;
  reset: HTMLElement;
  close: HTMLElement;
  /** The small line under the title ("טיימר מנוחה"). Optional: older markup has none. */
  sub?: HTMLElement;
}

/** What a `start` may say beyond its label. */
export interface StartOptions {
  /** The title once the countdown ends. Default: the rest-is-over line. */
  doneLabel?: string;
  /** The small line under the title. Default: "טיימר מנוחה". */
  sub?: string;
}

const DEFAULT_DONE_LABEL = 'המנוחה הסתיימה — לסט הבא! 💪';
const DEFAULT_SUB = 'טיימר מנוחה';

/* ------------------------------------------------------------ Web Audio */

type AudioCtor = typeof AudioContext;

let audioCtx: AudioContext | null = null;

function audioContextCtor(): AudioCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create the AudioContext on the first user gesture (iOS/Android requirement). */
export function initAudio(): void {
  try {
    if (!audioCtx) {
      const Ctor = audioContextCtor();
      if (Ctor) audioCtx = new Ctor();
    }
  } catch {
    /* audio unavailable — the timer still works silently */
  }
}

/** Synthesized completion chime: a rising 3-note arpeggio. */
export function chime(): void {
  try {
    if (!audioCtx) {
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      audioCtx = new Ctor();
    }
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    const notes: ReadonlyArray<readonly [number, number]> = [
      [880, 0],
      [1108.7, 0.18],
      [1318.5, 0.36],
    ];
    for (const [f, dt] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.5);
    }
  } catch {
    /* ignore */
  }
}

function vibrate(pattern: number[]): void {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav && typeof nav.vibrate === 'function') {
    try {
      nav.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

/* -------------------------------------------------------------- formatter */

export function fmtClock(s: number): string {
  const v = Math.max(0, Math.round(s));
  return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
}

/* ------------------------------------------------------------- the timer */

/**
 * How long the FINISHED bar stays on screen before it hides itself.
 *
 * Long enough to be read and acted on between two sets, short enough that a
 * "0:00" bar is never still sitting over the character screen minutes later.
 */
export const AUTO_HIDE_MS = 20_000;

export class RestTimer {
  private total = 90;
  private left = 90;
  private running = false;
  private iv: ReturnType<typeof setInterval> | null = null;
  private lastTick: number | null = null;
  private hideTo: ReturnType<typeof setTimeout> | null = null;
  private doneLabel = DEFAULT_DONE_LABEL;
  private readonly el: TimerElements;

  constructor(el: TimerElements) {
    this.el = el;
    this.el.plus.addEventListener('click', () => this.add(15));
    this.el.minus.addEventListener('click', () => this.sub(15));
    this.el.pause.addEventListener('click', () => this.togglePause());
    this.el.reset.addEventListener('click', () => this.reset());
    this.el.close.addEventListener('click', () => this.close());
    // Touching the bar AT ALL means the player is still using it — the
    // auto-hide is a courtesy for a bar nobody came back to, not a deadline.
    this.el.bar.addEventListener('pointerdown', () => this.cancelAutoHide());
    this.updateUI();
  }

  /**
   * Auto-called when a set is checked. A CARDIO stage starts it too, and then
   * it is not a rest at all: the label names the stage and the load, the small
   * line says "טיימר שלב", and the chime says to raise the incline rather than
   * to get back under the bar — hence `opts`.
   */
  start(seconds: number, label?: string, opts: StartOptions = {}): void {
    this.cancelAutoHide();
    this.total = seconds;
    this.left = seconds;
    this.running = true;
    this.doneLabel = opts.doneLabel ?? DEFAULT_DONE_LABEL;
    if (this.el.sub) this.el.sub.textContent = opts.sub ?? DEFAULT_SUB;
    this.el.title.textContent = label ?? 'מנוחה';
    this.el.bar.classList.add('show');
    this.el.bar.classList.remove('flash');
    this.setOpen(true);
    this.restartInterval();
    this.updateUI();
  }

  add(seconds: number): void {
    this.cancelAutoHide();
    this.left += seconds;
    this.total = Math.max(this.total, this.left);
    if (!this.running && this.left > 0) {
      this.running = true;
      this.restartInterval();
      this.el.bar.classList.remove('flash', 'zero');
    }
    this.updateUI();
  }

  sub(seconds: number): void {
    this.cancelAutoHide();
    this.left = Math.max(0, this.left - seconds);
    if (this.left === 0 && this.running) {
      this.running = false;
      this.stopInterval();
      this.done();
    }
    this.updateUI();
  }

  togglePause(): void {
    this.cancelAutoHide();
    if (this.left <= 0) return;
    this.running = !this.running;
    this.lastTick = null;
    if (this.running) this.restartInterval();
    this.updateUI();
  }

  reset(): void {
    this.cancelAutoHide();
    this.left = this.total;
    this.running = true;
    this.restartInterval();
    this.el.bar.classList.remove('flash', 'zero');
    this.updateUI();
  }

  close(): void {
    this.cancelAutoHide();
    this.running = false;
    this.stopInterval();
    this.el.bar.classList.remove('show', 'flash', 'zero');
    this.setOpen(false);
  }

  /* ------------------------------------------------------------ auto-hide */

  /** Hide the finished bar unless the player comes back to it first. */
  private armAutoHide(): void {
    this.cancelAutoHide();
    this.hideTo = setTimeout(() => {
      this.hideTo = null;
      this.close();
    }, AUTO_HIDE_MS);
  }

  private cancelAutoHide(): void {
    if (this.hideTo !== null) clearTimeout(this.hideTo);
    this.hideTo = null;
  }

  /**
   * The seam between the bar and the page: while it is up, every screen gets
   * the bottom padding that keeps the bar off its content.
   */
  private setOpen(open: boolean): void {
    const body: HTMLElement | null = this.el.bar.ownerDocument.body;
    if (body) body.classList.toggle('timer-open', open);
  }

  private restartInterval(): void {
    this.stopInterval();
    this.lastTick = null;
    this.iv = setInterval(() => this.tick(), 500);
  }

  private stopInterval(): void {
    if (this.iv !== null) clearInterval(this.iv);
    this.iv = null;
    this.lastTick = null;
  }

  /** Drift-corrected: subtract real elapsed ms, not a fixed 500. */
  private tick(): void {
    if (!this.running) {
      this.lastTick = null;
      return;
    }
    const now = Date.now();
    if (this.lastTick === null) this.lastTick = now;
    this.left -= (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.left <= 0) {
      this.left = 0;
      this.running = false;
      this.stopInterval();
      this.done();
    }
    this.updateUI();
  }

  private done(): void {
    this.el.bar.classList.add('flash');
    chime();
    vibrate([200, 100, 200, 100, 400]);
    this.el.title.textContent = this.doneLabel;
    this.armAutoHide();
  }

  private updateUI(): void {
    const finished = this.left <= 0;
    this.el.time.textContent = fmtClock(this.left);
    this.el.prog.style.width = (this.total ? (this.left / this.total) * 100 : 0) + '%';
    this.el.pause.textContent = this.running ? 'השהה' : 'המשך';
    // "0:00 · המשך" offers to continue something that is over. In the finished
    // state the control leaves the row entirely (and is disabled, so it is out
    // of the tab order too); איפוס starts the rest again, ✕ puts the bar away.
    this.el.pause.hidden = finished;
    (this.el.pause as HTMLElement & { disabled?: boolean }).disabled = finished;
    this.el.bar.classList.toggle('zero', finished);
  }
}

function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

/** Wire the timer to the static markup in index.html + unlock audio once. */
export function createRestTimer(): RestTimer {
  const sub = document.getElementById('tSub');
  const timer = new RestTimer({
    ...(sub ? { sub } : {}),
    bar: need('timerBar'),
    time: need('tTime'),
    prog: need('tProg'),
    title: need('tTitle'),
    plus: need('tPlus'),
    minus: need('tMinus'),
    pause: need('tPause'),
    reset: need('tReset'),
    close: need('tClose'),
  });
  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('click', initAudio, { once: true });
  return timer;
}
