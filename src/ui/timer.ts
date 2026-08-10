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
}

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

export class RestTimer {
  private total = 90;
  private left = 90;
  private running = false;
  private iv: ReturnType<typeof setInterval> | null = null;
  private lastTick: number | null = null;
  private readonly el: TimerElements;

  constructor(el: TimerElements) {
    this.el = el;
    this.el.plus.addEventListener('click', () => this.add(15));
    this.el.minus.addEventListener('click', () => this.sub(15));
    this.el.pause.addEventListener('click', () => this.togglePause());
    this.el.reset.addEventListener('click', () => this.reset());
    this.el.close.addEventListener('click', () => this.close());
    this.updateUI();
  }

  /** Auto-called when a set is checked. */
  start(seconds: number, label?: string): void {
    this.total = seconds;
    this.left = seconds;
    this.running = true;
    this.el.title.textContent = label ?? 'מנוחה';
    this.el.bar.classList.add('show');
    this.el.bar.classList.remove('flash');
    this.restartInterval();
    this.updateUI();
  }

  add(seconds: number): void {
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
    this.left = Math.max(0, this.left - seconds);
    if (this.left === 0 && this.running) {
      this.running = false;
      this.stopInterval();
      this.done();
    }
    this.updateUI();
  }

  togglePause(): void {
    if (this.left <= 0) return;
    this.running = !this.running;
    this.lastTick = null;
    if (this.running) this.restartInterval();
    this.updateUI();
  }

  reset(): void {
    this.left = this.total;
    this.running = true;
    this.restartInterval();
    this.el.bar.classList.remove('flash', 'zero');
    this.updateUI();
  }

  close(): void {
    this.running = false;
    this.stopInterval();
    this.el.bar.classList.remove('show', 'flash');
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
    this.el.title.textContent = 'המנוחה הסתיימה — לסט הבא! 💪';
  }

  private updateUI(): void {
    this.el.time.textContent = fmtClock(this.left);
    this.el.prog.style.width = (this.total ? (this.left / this.total) * 100 : 0) + '%';
    this.el.pause.textContent = this.running ? 'השהה' : 'המשך';
    this.el.bar.classList.toggle('zero', this.left <= 0);
  }
}

function need(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

/** Wire the timer to the static markup in index.html + unlock audio once. */
export function createRestTimer(): RestTimer {
  const timer = new RestTimer({
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
