/**
 * @vitest-environment jsdom
 *
 * CROSS-DEVICE RENDERING — the things a Galaxy S24 got wrong while a Pixel 10
 * rendered the very same build correctly. Every case here comes from a real
 * screenshot, and each one is asserted at the level it can actually be pinned
 * down at:
 *
 *   - ANDROID FONT BOOSTING inflated the header and split the nav labels over
 *     two lines. The fix is one declaration in the stylesheet, so the test is a
 *     string assertion on the source the build inlines — jsdom has no layout,
 *     and a layout-free assertion that lies is worse than none;
 *   - THE REST TIMER BAR overflowed the screen sideways (a clipped label, the
 *     button row past the edge) and then LINGERED at 0:00 over the character
 *     screen, still offering "המשך". The layout half is again CSS, checked as
 *     CSS plus the structural hooks it needs in the markup; the life-cycle half
 *     is real behaviour and is driven here with fake timers.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTO_HIDE_MS, RestTimer } from '../src/ui/timer.ts';

const sheet = (name: string): string => readFileSync(resolve(process.cwd(), 'styles', name), 'utf8');
const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

/** The declarations of one rule, as authored. */
function ruleOf(css: string, selector: string): string {
  const i = css.indexOf(selector + '{');
  expect(i, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
}

/* ------------------------------------------------------- font boosting */

describe('Android text autosizing', () => {
  it('opts out at the root, in both spellings, in a stylesheet the build inlines', () => {
    const base = ruleOf(sheet('base.css'), 'html');
    // Samsung Internet still needs the prefix; Chrome takes the standard one.
    expect(base).toContain('-webkit-text-size-adjust:100%');
    expect(base).toMatch(/[^-]text-size-adjust:100%/);
    // …and base.css is part of the single stylesheet the singlefile build emits
    expect(sheet('index.css')).toContain("@import './base.css'");
  });

  it('gives the two biggest header lines a hard ceiling', () => {
    const base = sheet('base.css');
    // A clamp() with an explicit maximum cannot be inflated past what it was
    // designed at, whatever the renderer thinks the page needs.
    expect(ruleOf(base, '.app-title')).toMatch(/font-size:clamp\([^)]*,20px\)/);
    expect(ruleOf(base, '.day-meta')).toMatch(/font-size:clamp\([^)]*,13\.5px\)/);
  });

  it('keeps the nav labels on one line by eliding them, not by shrinking them', () => {
    // The hub/tab captions were already single-line + ellipsis; this is the
    // property that made the boosted build merely ugly instead of unusable, so
    // it is worth a test of its own.
    const tabs = sheet('tabs.css');
    for (const selector of ['.hub .h-label', '.tab .d', '.tab .w']) {
      const rule = ruleOf(tabs, selector);
      expect(rule, selector).toContain('white-space:nowrap');
      expect(rule, selector).toContain('text-overflow:ellipsis');
    }
  });
});

/* --------------------------------------------------- the bar's layout */

describe('the rest timer bar on a narrow phone', () => {
  const timer = sheet('timer.css');

  it('can never paint outside the viewport', () => {
    const bar = ruleOf(timer, '#timerBar');
    expect(bar).toContain('max-width:100%');
    expect(bar).toContain('overflow:hidden');
  });

  it('lets the row wrap instead of overflowing, and the clock shrink', () => {
    expect(ruleOf(timer, '.t-inner')).toContain('flex-wrap:wrap');
    const time = ruleOf(timer, '.t-time');
    expect(time).toMatch(/font-size:clamp\(/); // not a fixed 34px
    expect(time).not.toContain('min-width:100px'); // the old floor
  });

  it('gives the label the min-width:0 that makes its ellipsis actually fire', () => {
    // A flex child refuses to shrink below its content width unless min-width
    // is cleared — without this, `text-overflow` never triggers and the label
    // pushes the buttons off the screen instead of eliding.
    expect(ruleOf(timer, '.t-label')).toContain('min-width:0');
    for (const line of ['.t-label .ttl', '.t-label .sub']) {
      const rule = ruleOf(timer, line);
      expect(rule, line).toContain('overflow:hidden');
      expect(rule, line).toContain('text-overflow:ellipsis');
      expect(rule, line).toContain('white-space:nowrap');
    }
  });

  it('drops the controls onto a row of their own on a narrow screen', () => {
    const narrow = /@media \(max-width:4\d\dpx\)\{([\s\S]*?)\n\}/.exec(timer)?.[1] ?? '';
    expect(narrow, 'no narrow-screen block').not.toBe('');
    expect(narrow).toContain('flex:1 0 100%'); // the button row takes the width
    expect(narrow).toContain('flex:1 1 0'); // …and the five buttons share it
    // and they stay thumb-sized: the app's ≥40px target rule
    expect(ruleOf(timer, '.t-btn')).toContain('min-height:40px');
  });

  it('carries the structural hooks that CSS needs, in the shell', () => {
    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    const inner = document.querySelector('#timerBar .t-inner');
    expect(inner).not.toBeNull();
    expect(inner?.querySelector('.t-time')).not.toBeNull();
    expect(inner?.querySelector('.t-label .ttl')).not.toBeNull();
    expect(inner?.querySelector('.t-label .sub')).not.toBeNull();
    expect(inner?.querySelectorAll('.t-btns .t-btn')).toHaveLength(5);
    // RTL is the document's, not the bar's own trick: it only re-states it.
    expect(document.querySelector('#timerBar')?.getAttribute('dir')).toBe('rtl');
  });

  it('reserves room under EVERY screen while it is open', () => {
    // The legacy gutter was a constant that happened to fit the workout screen.
    // The class is toggled by the timer itself, so the padding follows the bar.
    const rule = ruleOf(sheet('base.css'), 'body.timer-open');
    expect(rule).toContain('padding-bottom:calc(');
    expect(rule).toContain('env(safe-area-inset-bottom)');
  });
});

/* ------------------------------------------------- the bar's life cycle */

describe('the rest timer bar after the countdown', () => {
  let timer: RestTimer;

  const el = (id: string): HTMLElement => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`missing #${id}`);
    return found;
  };
  const bar = (): HTMLElement => el('timerBar');
  const click = (id: string): void => {
    el(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    document.body.className = '';
    timer = new RestTimer({
      bar: el('timerBar'),
      time: el('tTime'),
      prog: el('tProg'),
      title: el('tTitle'),
      plus: el('tPlus'),
      minus: el('tMinus'),
      pause: el('tPause'),
      reset: el('tReset'),
      close: el('tClose'),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the page while it is up, so no screen is overlapped', () => {
    expect(document.body.classList.contains('timer-open')).toBe(false);
    timer.start(30, 'לחיצת חזה · סט 1 הושלם');
    expect(bar().classList.contains('show')).toBe(true);
    expect(document.body.classList.contains('timer-open')).toBe(true);

    click('tClose');
    expect(bar().classList.contains('show')).toBe(false);
    expect(document.body.classList.contains('timer-open')).toBe(false);
  });

  it('stops offering "המשך" once there is nothing left to continue', () => {
    timer.start(2);
    const pause = el('tPause') as HTMLButtonElement;
    expect(pause.hidden).toBe(false);
    expect(pause.disabled).toBe(false);

    vi.advanceTimersByTime(2_500);

    expect(el('tTime').textContent).toBe('0:00');
    expect(bar().classList.contains('zero')).toBe(true);
    expect(pause.hidden).toBe(true); // no "המשך" over a finished clock
    expect(pause.disabled).toBe(true); // …and out of the tab order with it
    // the two controls that still DO something stay
    expect((el('tReset') as HTMLButtonElement).hidden).toBe(false);
    expect((el('tClose') as HTMLButtonElement).hidden).toBe(false);
    expect(el('tTitle').textContent).toContain('הסתיימה');
  });

  it('hides itself a while after finishing instead of floating there forever', () => {
    timer.start(2);
    vi.advanceTimersByTime(2_500);
    expect(bar().classList.contains('show')).toBe(true); // still up, and read

    vi.advanceTimersByTime(AUTO_HIDE_MS - 1_000);
    expect(bar().classList.contains('show')).toBe(true); // not yet

    vi.advanceTimersByTime(2_000);
    expect(bar().classList.contains('show')).toBe(false);
    expect(bar().classList.contains('zero')).toBe(false);
    expect(document.body.classList.contains('timer-open')).toBe(false);
  });

  it('keeps the bar as long as the player is still touching it', () => {
    timer.start(2);
    vi.advanceTimersByTime(2_500);

    // The auto-hide is a courtesy for a bar nobody came back to. Coming back to
    // it — a touch anywhere on it — takes it off the table entirely.
    bar().dispatchEvent(new Event('pointerdown', { bubbles: true }));

    vi.advanceTimersByTime(AUTO_HIDE_MS * 3);
    expect(bar().classList.contains('show')).toBe(true);
    expect(document.body.classList.contains('timer-open')).toBe(true);
  });

  it('pushes the deadline back when איפוס starts the rest again', () => {
    timer.start(2);
    vi.advanceTimersByTime(2_500); // done; the hide is armed

    click('tReset'); // …and re-armed only when THIS rest ends, 2s from now
    vi.advanceTimersByTime(AUTO_HIDE_MS);
    expect(bar().classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(3_000);
    expect(bar().classList.contains('show')).toBe(false);
  });

  it('brings the pause control back when time is added to a finished rest', () => {
    timer.start(2);
    vi.advanceTimersByTime(2_500);
    const pause = el('tPause') as HTMLButtonElement;
    expect(pause.hidden).toBe(true);

    click('tPlus');

    expect(pause.hidden).toBe(false);
    expect(pause.disabled).toBe(false);
    expect(pause.textContent).toBe('השהה');
    expect(bar().classList.contains('zero')).toBe(false);
    expect(el('tTime').textContent).toBe('0:15');
  });

  it('never lets a pending hide close the bar during the NEXT set', () => {
    timer.start(2);
    vi.advanceTimersByTime(2_500); // done; a hide is pending

    timer.start(90, 'סט 2'); // …and the next set starts before it fires
    vi.advanceTimersByTime(AUTO_HIDE_MS * 2);

    expect(bar().classList.contains('show')).toBe(true);
    expect(document.body.classList.contains('timer-open')).toBe(true);
    expect(el('tTitle').textContent).toBe('סט 2');
    expect(el('tTime').textContent).toMatch(/^0:5\d$/); // still counting, not closed
  });
});
