/**
 * ui/history.ts — the היסטוריה screen (view `H`), second inner tab of the
 * settings hub: the game-event feed (see ui/feed.ts) and the logged-workout
 * history, and nothing else.
 *
 * The account card, the plan card and export / import / clear used to sit on
 * top of this list. They moved one tab across, to ui/settings.ts — they are
 * things you PRESS, this is a thing you READ, and the screen was the only place
 * in the app where those two lived in the same scroll. What is left here is the
 * record of what actually happened: every workout, newest first, plus the
 * adventure feed that narrates it.
 *
 * ---------------------------------------------------------------------------
 * TWO PANES INSTEAD OF ONE ENDLESS PAGE
 * ---------------------------------------------------------------------------
 * Both records used to be full-length lists, so a player with three months of
 * training got a page metres long: the adventure feed pushed the workout log
 * off the bottom, and finding "what did I lift on the 4th" meant scrolling past
 * everything newer. Now each record owns a FIXED-HEIGHT PANE that scrolls by
 * itself (`.scroll-pane`), so both section headers stay on screen and the page
 * itself barely moves.
 *
 * And the workout log is no longer a list at all: it is a wrap of DATE BUBBLES,
 * newest first, one per day that has a logged set. Tapping one expands that
 * day's card — the same `.hist-day` markup this file has always produced —
 * inside the pane, directly under the bubbles. One panel at a time: this is a
 * lookup ("the 4th"), not a feed, and a screen that answers a lookup should not
 * make you scroll past twelve other answers to read it.
 *
 * WHICH BUBBLE IS OPEN IS NOT STATE. It is a module-level `openDate`, in memory
 * only — never persisted, never an event. A full re-render of the screen starts
 * closed (a repaint already resets the page scroll, so leaving a panel dangling
 * open would be the odd one out); a TAP updates the bubbles and the panel in
 * place, so the pane keeps its scroll position and nothing else on screen moves.
 */

import { dayLabelOf, dayOf, type ExerciseResolver, type ResolvedProgram } from '../data/program.ts';
import { fmtDate, isSetFilled, isWorkoutComplete } from '../core/workout.ts';
import { makeResolver, resolveProgram } from '../core/plan.ts';
import type { AppState, DataStore } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { renderFeed } from './feed.ts';

export interface HistoryDeps {
  store: DataStore;
}

/** One logged day, ready to be drawn as a bubble and expanded into a card. */
interface LoggedDay {
  date: string;
  /** Bubble line 1 — "5.1", the day and month a thumb can read at a glance. */
  short: string;
  /** Bubble line 2 — the day's label, abbreviated ("אימון A" → "A"). */
  chip: string;
  /** The full label, for the bubble's accessible name and its panel. */
  label: string;
  /** Every set of every exercise of the day is ticked. */
  done: boolean;
  /** The expanded panel: the `.hist-day` card this screen has always drawn. */
  html: string;
}

/**
 * The date whose panel is open, or `null`. Transient UI state — see the file
 * header. It is reset by every full render, so no test and no screen switch can
 * inherit a panel somebody else opened.
 */
let openDate: string | null = null;

/** "2025-01-05" → "5.1" (an unparsable date is left exactly as it came). */
function shortDate(iso: string): string {
  const parts = iso.split('-');
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!parts[1] || !parts[2] || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
  return `${d}.${m}`;
}

/**
 * A day label small enough for a bubble: "אימון A" → "A", "חלק א׳" → "א׳".
 *
 * A multi-word label ending in a short word is almost always "<noun> <letter>",
 * and the letter is the part that tells two days apart; anything else keeps its
 * first word, clipped. The FULL label is never lost — it is the bubble's
 * accessible name and the heading of the panel it opens.
 */
function chipLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  if (last && last.length <= 3) return last;
  const first = words[0] ?? '';
  return first.length > 7 ? `${first.slice(0, 6)}…` : first;
}

/**
 * One day's card: the date, the day's name and every exercise with its sets.
 *
 * Unchanged from the list this screen used to be — it is simply rendered on
 * demand now. History is shown by DAY KEY, long after a plan may have dropped
 * that day. `dayLabelOf` names it anyway (the plan's label, then the built-in
 * one for a legacy A/B/C session, then a neutral "אימון"); the weekday caption
 * and the focus line only exist while the day itself does, and are simply left
 * out rather than borrowed from some other day.
 */
function dayCard(
  state: AppState,
  date: string,
  program: ResolvedProgram,
  resolve: ExerciseResolver,
): string {
  const s = state.sessions[date];
  if (!s) return '';
  const p = dayOf(program, s.day);
  const label = dayLabelOf(program, s.day);
  const exHtml = Object.keys(s.ex)
    .map((exId) => {
      const exDef = resolve(exId);
      const sets = (s.ex[exId] ?? []).filter((x) => isSetFilled(x));
      if (!sets.length) return '';
      const setsTxt = sets
        .map((x) => `${x && x.w !== '' ? esc(x.w) : '–'}kg×${x && x.r !== '' ? esc(x.r) : '–'}${x && x.done ? '✓' : ''}`)
        .join('  |  ');
      return `<div class="hist-ex"><b>${esc(exDef ? exDef.he : exId)}</b><br><span class="hist-sets">${setsTxt}</span></div>`;
    })
    .join('');
  if (!exHtml) return '';
  const title = ` · ${esc(label)}${p ? ` (יום ${esc(p.day)})` : ''}`;
  return `<div class="hist-day">
        <h3>${fmtDate(date)}${title}</h3>
        <div class="sub">${p ? esc(p.focus) : ''}</div>
        ${exHtml}
      </div>`;
}

/** Every day with at least one logged set, newest first. */
function loggedDays(state: AppState, program: ResolvedProgram, resolve: ExerciseResolver): LoggedDay[] {
  return Object.keys(state.sessions)
    .sort()
    .reverse()
    .map((date) => {
      const s = state.sessions[date];
      const html = dayCard(state, date, program, resolve);
      // A day whose sets are all empty renders no card, so it gets no bubble
      // either — exactly the days the old list silently dropped.
      if (!s || !html) return null;
      const label = dayLabelOf(program, s.day);
      return {
        date,
        short: shortDate(date),
        chip: chipLabel(label),
        label,
        done: isWorkoutComplete(state, s.day, date, program),
        html,
      };
    })
    .filter((d): d is LoggedDay => d !== null);
}

function bubbleHtml(d: LoggedDay): string {
  const name = `${fmtDate(d.date)} · ${d.label}${d.done ? ' · הושלם' : ''}`;
  return `<button type="button" class="day-bubble${d.done ? ' done' : ''}" data-date="${esc(d.date)}"
      aria-expanded="false" aria-controls="histDayPanel" aria-label="${esc(name)}" title="${esc(name)}">
      ${d.done ? `<span class="db-tick" aria-hidden="true">✓</span>` : ''}
      <span class="db-date">${esc(d.short)}</span>
      <span class="db-chip">${esc(d.chip)}</span>
    </button>`;
}

export function renderHistory(main: HTMLElement, deps: HistoryDeps): void {
  const state = deps.store.getState();
  const program = resolveProgram(state.plan);
  // History shows exercises BY ID, long after a plan may have changed — so it
  // resolves through the plan (customs included) and still tolerates an id that
  // resolves to nothing at all.
  const resolve = makeResolver(state.plan);
  const days = loggedDays(state, program, resolve);
  openDate = null;

  const log =
    days.length === 0
      ? `<div class="empty">עדיין אין אימונים מתועדים.<br>סמנו סטים באחד מימי האימון והם יופיעו כאן. 💪</div>`
      : `<div class="scroll-pane log-scroll">
      <div class="day-bubbles" aria-label="ימי אימון מתועדים">${days.map(bubbleHtml).join('')}</div>
      <div class="day-panel" id="histDayPanel" role="region" aria-label="פירוט האימון"></div>
    </div>`;

  main.innerHTML = `
  ${renderFeed(deps.store.getEvents(), 40, resolve, (key) => dayLabelOf(program, key))}
  <h2 class="hist-heading">אימונים מתועדים <span class="hist-hint">בחרו תאריך</span></h2>
  ${log}`;

  bindBubbles(main, days);
}

/**
 * Wire the bubbles. A tap rewrites ONLY the bubble classes and the panel, so
 * the pane keeps its scroll position and the feed above is never re-rendered.
 */
function bindBubbles(main: HTMLElement, days: readonly LoggedDay[]): void {
  const panel = main.querySelector<HTMLElement>('#histDayPanel');
  if (!panel) return;
  const bubbles = [...main.querySelectorAll<HTMLButtonElement>('.day-bubble')];

  const paint = (): void => {
    for (const b of bubbles) {
      const on = b.dataset['date'] === openDate;
      b.classList.toggle('open', on);
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    const day = days.find((d) => d.date === openDate);
    panel.innerHTML = day ? day.html : '';
    if (day) reveal(panel);
  };

  for (const b of bubbles) {
    b.addEventListener('click', () => {
      const date = b.dataset['date'] ?? '';
      // Same bubble closes, another bubble switches — one panel, always.
      openDate = openDate === date ? null : date;
      paint();
    });
  }
}

/**
 * Bring a freshly opened panel into view inside its pane. `scrollIntoView` is
 * what gets RTL and nested scrollers right, and it is absent in jsdom — hence
 * the capability check rather than a call. `block:'nearest'` means a panel that
 * is already visible does not move at all, and there is no `behavior:'smooth'`:
 * an unrequested animated scroll is exactly what prefers-reduced-motion is
 * about, and this one has nothing to say that the instant jump does not.
 */
function reveal(panel: HTMLElement): void {
  if (typeof panel.scrollIntoView !== 'function') return;
  try {
    panel.scrollIntoView({ block: 'nearest' });
  } catch {
    /* older engines: the panel is simply left where it is */
  }
}
