/**
 * ui/weight.ts — the ⚖️ משקל screen (view `WT`), the nutrition hub's second
 * inner tab: a weight log with a chart.
 *
 * A TRACKER, NOT A GAME SCREEN, like its sibling ui/nutrition.ts: nothing here
 * grants XP, energy or coins. The cards read `state.nutrition` and the drivers
 * in core/weight.ts append tracker events (`weight_logged` / `weight_deleted` /
 * `weight_target_set`) that the game reducer never sees. Fully offline.
 *
 * THE CHART follows the conventions ui/stats.ts set: inline SVG built as a
 * string, one hue (`--accent`) for the data, thin marks, recessive chrome, and
 * TIME FLOWING RIGHT → LEFT — the oldest entry sits at the right edge, the
 * newest at the left, where a Hebrew reader's eye lands last. The x axis is
 * ENTRIES, not days: a weigh-in is a point, and the gaps between weigh-ins are
 * not data (the tooltips carry the dates). The y axis is the entries' own
 * range with a little air — never zero, which would flatten a 3 kg journey
 * into a straight line — and its three gridline labels are digits, the one
 * kind of SVG text bidi cannot mangle.
 *
 * Two quieter lines ride along: the 7-entry trend (dashed accent — daily
 * weight is noisy by a kilo either way, this is where it is going) and the
 * goal weight (dashed `--ok`), drawn only when it falls inside the plotted
 * range so it never squashes the data to make room for itself.
 */

import { fmtDate, todayISO } from '../core/workout.ts';
import {
  WEIGHT_MAX_KG,
  WEIGHT_MAX_NOTE_LEN,
  WEIGHT_MIN_KG,
  WEIGHT_TREND_WINDOW,
  deleteWeight,
  goalProgress,
  isCalendarDate,
  logWeight,
  movingAverage,
  setWeightTarget,
  weightEntries,
  weightSummary,
  type WeightRow,
  type WeightSummary,
} from '../core/weight.ts';
import { RING_CIRC, RING_R } from './nutrition.ts';
import type { DataStore, NutritionState } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { isRtl, tr } from '../i18n/locale.ts';
import { KG_PER_LB, displayToKg, kgToDisplay, units } from '../i18n/units.ts';
import { weight as M } from '../i18n/messages/weight.ts';

export interface WeightDeps {
  store: DataStore;
  /** Repaint header + main in place (no scroll reset). Absent in bare tests. */
  rerender?: () => void;
  /** Injectable for tests. */
  today?: string;
}

/** How many of the newest entries the chart shows. */
export type WeightRange = 10 | 30 | 'all';
/** The Hebrew labels (kept for importers); the screen reads the current locale's. */
export const WEIGHT_RANGES: readonly { key: WeightRange; label: string }[] = [
  { key: 10, label: M.he.ranges[10] },
  { key: 30, label: M.he.ranges[30] },
  { key: 'all', label: M.he.ranges.all },
] as const;

/* -------------------------------------------------------- screen-local state */

/** The chart's range. In memory only, like a hub's last tab. */
let range: WeightRange = 30;

/** Forget everything screen-local (tests, and a data wipe). */
export function resetWeightScreen(): void {
  range = 30;
}

/* ------------------------------------------------------------- formatting */

/**
 * The body-weight unit as the copy prints it: "ק״ג" in Hebrew (gershayim, as
 * this screen always did), "kg" in English, "lb" in imperial in either.
 */
export function wUnit(): string {
  return units() === 'imperial' ? 'lb' : tr(M).kg;
}

/**
 * A stored kilogram value in the display unit: metric is `fmtKg` byte for
 * byte; imperial shows pounds to one decimal ("180.0").
 */
export function fmtWeight(kg: number): string {
  return units() === 'imperial' ? kgToDisplay(kg).toFixed(1) : fmtKg(kg);
}

/**
 * "82.4" / "79.45" — the scale's own precision: at least one decimal so a
 * column of weights lines up, a second only when it carries information.
 * Never "79.5" for 79.45: a weigh-in is shown as it was entered.
 */
export function fmtKg(kg: number): string {
  return kg.toFixed(2).replace(/0$/, '');
}

/**
 * "+0.4" / "−0.6" / "±0.0", as one LTR run so the sign stays in front of the
 * digits inside an RTL sentence. Direction is NOT coloured: down is the goal
 * of a cut and up the goal of a bulk, and the tracker does not presume which.
 */
export function fmtDelta(d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `<span class="wt-delta" dir="ltr">${sign}${fmtWeight(Math.abs(d))}</span>`;
}

/** The header's one line under the title. */
export function weightHeadline(n: NutritionState): string {
  const s = weightSummary(n);
  const m = tr(M);
  if (!s.latest) return m.headlineEmpty;
  const change = s.sincePrevious === null ? '' : m.headlineChange(plainDelta(s.sincePrevious));
  return m.headline(fmtWeight(s.latest.kg), wUnit(), change);
}

/** `fmtDelta` without markup, for `textContent` slots (the header line). */
function plainDelta(d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `⁦${sign}${fmtWeight(Math.abs(d))}⁩`;
}

/* ------------------------------------------------------------------ chart */

const CHART_W = 320;
const CHART_H = 150;
const PAD_X = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 12;
/** The gutter for the y labels, where a line starts: the right in Hebrew, the left in English. */
const LABEL_W = 34;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** How far outside the data a goal may sit and still be drawn: 3 kg, or the data's own span. */
const GOAL_REACH_KG = 3;

/**
 * The y range: the data's own span plus 15% of air (at least half a kilo), so
 * a 3 kg journey fills the card instead of hugging a zero baseline. A goal
 * weight stretches the range only while it is NEAR — within 3 kg of the data,
 * or within the data's own span — so the line the user is walking toward is
 * on the chart, but a goal 15 kg away never flattens every real movement into
 * a straight line to make room for itself.
 */
export function chartRange(rows: readonly WeightRow[], target: number | null = null): { lo: number; hi: number } {
  let min = rows.reduce((m, r) => Math.min(m, r.kg), Number.POSITIVE_INFINITY);
  let max = rows.reduce((m, r) => Math.max(m, r.kg), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1 };
  if (target !== null) {
    const reach = Math.max(GOAL_REACH_KG, max - min);
    if (target < min && min - target <= reach) min = target;
    if (target > max && target - max <= reach) max = target;
  }
  const pad = Math.max(0.5, (max - min) * 0.15);
  return { lo: round1(min - pad), hi: round1(max + pad) };
}

/**
 * The weight line. `rows` are the entries ON SCREEN (already ranged), oldest
 * first; `trend` is their moving average, computed over the WHOLE log so the
 * line at the right edge already knows what came before it.
 */
export function weightChartSvg(rows: readonly WeightRow[], trend: readonly number[], target: number | null): string {
  const n = rows.length;
  if (n === 0) return '';
  const { lo, hi } = chartRange(rows, target);
  const rtl = isRtl();
  const m = tr(M);
  const u = wUnit();
  const plotLeft = rtl ? PAD_X : LABEL_W + PAD_X;
  const plotRight = rtl ? CHART_W - LABEL_W - PAD_X : CHART_W - PAD_X;
  const plotW = plotRight - plotLeft;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const step = n > 1 ? plotW / (n - 1) : 0;
  // i = 0 is the OLDEST entry and sits at the reading START of the plot: time
  // runs with the reading direction — right to left in Hebrew, left to right
  // in English.
  const x = (i: number): number =>
    rtl ? Math.round((plotRight - i * step) * 10) / 10 : Math.round((plotLeft + i * step) * 10) / 10;
  const y = (kg: number): number => Math.round((PAD_TOP + (1 - (kg - lo) / (hi - lo)) * plotH) * 10) / 10;
  const baseline = PAD_TOP + plotH;

  const points = rows.map((r, i) => `${x(i)},${y(r.kg)}`);
  const line = `M${points.join(' L')}`;
  const area = n > 1 ? `${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z` : '';

  // Three hairlines with their values in the gutter: top, middle, bottom.
  const grid = [hi, round1((hi + lo) / 2), lo]
    .map(
      (v) =>
        `<line class="wt-grid" x1="${plotLeft}" y1="${y(v)}" x2="${plotRight}" y2="${y(v)}"/>` +
        `<text class="wt-ylab" x="${rtl ? CHART_W - 2 : 2}" y="${y(v) + 3}" text-anchor="${rtl ? 'end' : 'start'}">${fmtWeight(v)}</text>`,
    )
    .join('');

  const trendPath =
    n >= 3 && trend.length === n ? `<path class="wt-trend" d="M${rows.map((_, i) => `${x(i)},${y(trend[i] ?? 0)}`).join(' L')}"/>` : '';

  const goal =
    target !== null && target >= lo && target <= hi
      ? `<line class="wt-goal" x1="${plotLeft}" y1="${y(target)}" x2="${plotRight}" y2="${y(target)}"/>`
      : '';

  const dots = rows
    .map((r, i) => {
      const when = r.time ? `${fmtDate(r.date)} ${r.time}` : fmtDate(r.date);
      return (
        `<circle class="wt-hit" cx="${x(i)}" cy="${y(r.kg)}" r="6">` +
        `<title>${esc(when)} · ${fmtWeight(r.kg)} ${u}${r.note ? ` · ${esc(r.note)}` : ''}</title></circle>` +
        `<circle class="wt-pt" cx="${x(i)}" cy="${y(r.kg)}" r="2"/>`
      );
    })
    .join('');
  const last = rows[n - 1];
  const lastDot = last
    ? `<circle class="wt-dot" cx="${x(n - 1)}" cy="${y(last.kg)}" r="4.5"/>` +
      // The newest value, spelled out beside its marker — the one direct label.
      `<text class="wt-vlab" x="${rtl ? x(n - 1) + 8 : x(n - 1) - 8}" y="${y(last.kg) + 3.5}" text-anchor="${rtl ? 'start' : 'end'}" direction="ltr">${fmtWeight(last.kg)}</text>`
    : '';

  return `<svg class="chart wt-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img"
    aria-label="${esc(m.chartAria(n, fmtWeight(lo), fmtWeight(hi), u))}">
    ${grid}
    ${goal}
    ${area ? `<path class="wt-area" d="${area}"/>` : ''}
    ${n > 1 ? `<path class="wt-line" d="${line}"/>` : ''}
    ${trendPath}
    ${dots}
    ${lastDot}
  </svg>`;
}

/* ------------------------------------------------------------------- html */

/**
 * The journey ring: how much of the way from the FIRST weigh-in to the goal
 * is behind you. Same geometry and classes as the nutrition rings (one hue,
 * digits in SVG, the Hebrew in HTML), but reaching THIS target is "good", so
 * a finished ring is `--ok`, never `--warn`. Without a goal the track is
 * dashed and the change since the first weigh-in sits in the middle instead.
 */
export function journeyRingHtml(s: WeightSummary, target: number | null, first: number | null): string {
  const latest = s.latest;
  if (!latest || first === null) return '';
  const m = tr(M).ring;
  const u = wUnit();
  const has = target !== null;
  const pct = has ? goalProgress(first, latest.kg, target) : 0;
  const done = has && s.targetReached;
  const offset = Math.round(RING_CIRC * (1 - pct) * 10) / 10;
  const pctText = `${Math.round(pct * 100)}%`;
  const sinceFirst = s.sinceFirst;
  const big = has ? pctText : sinceFirst === null ? '—' : `${sinceFirst > 0 ? '+' : sinceFirst < 0 ? '−' : '±'}${fmtWeight(Math.abs(sinceFirst))}`;
  const small = has ? m.ofTheWay : m.sinceStart;
  const label = has ? m.goal(fmtWeight(target), u) : m.count(s.count);
  const sub = !has
    ? `<span class="nt-ring-sub dim">${m.noGoal}</span>`
    : done
      ? `<span class="nt-ring-sub done">${m.reached}</span>`
      : `<span class="nt-ring-sub">${m.left(fmtWeight(Math.abs(s.toTarget ?? 0)), u)}</span>`;
  const aria = has ? m.ariaGoal(pctText, fmtWeight(target), u) : m.ariaNoGoal(s.count);
  return `
    <div class="nt-ring wt-ring ${has ? 'has-target' : 'no-target'} ${done ? 'done' : ''}" role="img" aria-label="${esc(aria)}">
      <svg viewBox="0 0 100 100" class="nt-ring-svg" aria-hidden="true">
        <circle class="nt-ring-track" cx="50" cy="50" r="${RING_R}"/>
        ${
          has
            ? `<circle class="nt-ring-fill" cx="50" cy="50" r="${RING_R}"
          style="--circ:${RING_CIRC};stroke-dasharray:${RING_CIRC};stroke-dashoffset:${offset}"/>`
            : ''
        }
        <text class="nt-ring-val ${has ? '' : 'wt-ring-delta'}" x="50" y="49" text-anchor="middle" direction="ltr">${big}</text>
        <text class="nt-ring-pct" x="50" y="64" text-anchor="middle">${small}</text>
      </svg>
      <span class="nt-ring-lab">${label}</span>
      ${sub}
    </div>`;
}

function summaryCard(s: WeightSummary, target: number | null, first: number | null): string {
  const m = tr(M).summary;
  const u = wUnit();
  if (!s.latest) {
    return `
  <section class="game-card wt-summary">
    <div class="gc-title">${m.title}</div>
    <p class="empty">${m.empty}</p>
  </section>`;
  }
  const stat = (label: string, d: number | null): string =>
    `<div class="wt-stat"><span class="wt-stat-val">${d === null ? '<span class="dim">—</span>' : fmtDelta(d)}</span><span class="wt-stat-lab">${label}</span></div>`;
  const goal =
    s.toTarget === null
      ? `<p class="gc-note dim wt-hint">${m.goalHint}</p>`
      : s.targetReached
        ? `<p class="gc-note wt-goal-note ok">${m.goalReached(fmtWeight(s.latest.kg), u)}</p>`
        : `<p class="gc-note wt-goal-note">${m.goalLeft(fmtWeight(Math.abs(s.toTarget)), u)}</p>`;
  return `
  <section class="game-card wt-summary">
    <div class="gc-title">${m.title} <span class="gc-sub">${esc(fmtDate(s.latest.date))}${s.latest.time ? ` · ${esc(s.latest.time)}` : ''}</span></div>
    <div class="wt-hero">
      ${journeyRingHtml(s, target, first)}
      <div class="wt-hero-text">
        <div class="wt-current"><b>${fmtWeight(s.latest.kg)}</b> <span class="wt-unit">${u}</span></div>
        ${s.trend !== null && s.count >= 3 ? `<span class="wt-trend-val dim">${m.trend(fmtWeight(s.trend), u)}</span>` : ''}
        ${s.min !== null && s.max !== null && s.count >= 2 ? `<span class="wt-range-val dim">${m.range(`<span class="wt-delta" dir="ltr">${fmtWeight(s.min)}–${fmtWeight(s.max)}</span>`, u)}</span>` : ''}
      </div>
    </div>
    <div class="wt-stats">
      ${stat(m.sincePrev, s.sincePrevious)}
      ${stat(m.days7, s.sevenDay)}
      ${stat(m.days30, s.thirtyDay)}
      ${stat(m.sinceFirst, s.sinceFirst)}
    </div>
    ${goal}
  </section>`;
}

function rangeSeg(): string {
  const m = tr(M);
  return `<div class="wt-range" role="group" aria-label="${m.chart.rangeAria}">${WEIGHT_RANGES.map(
    (r) =>
      `<button class="wt-seg ${r.key === range ? 'active' : ''}" type="button" data-range="${r.key}"
        aria-pressed="${r.key === range ? 'true' : 'false'}">${m.ranges[r.key]}</button>`,
  ).join('')}</div>`;
}

function chartCard(all: readonly WeightRow[], target: number | null): string {
  if (all.length === 0) return '';
  const shown = range === 'all' ? all : all.slice(-range);
  const trendAll = movingAverage(all);
  const trend = trendAll.slice(all.length - shown.length);
  const { lo, hi } = chartRange(shown, target);
  const m = tr(M).chart;
  const u = wUnit();
  const goalNote =
    target === null
      ? ''
      : target < lo || target > hi
        ? `<span class="cl-item dim">${m.goalOff(fmtWeight(target), u)}</span>`
        : `<span class="cl-item"><i class="dot goal"></i>${m.goal(`<b>${fmtWeight(target)} ${u}</b>`)}</span>`;
  return `
  <section class="game-card wt-chart-card">
    <div class="gc-title">${m.title} <span class="gc-sub">${m.count(shown.length)}</span></div>
    ${rangeSeg()}
    ${weightChartSvg(shown, trend, target)}
    <div class="chart-legend">
      <span class="cl-item"><i class="dot"></i>${m.weight}</span>
      ${shown.length >= 3 ? `<span class="cl-item"><i class="dot trend"></i>${m.avg(WEIGHT_TREND_WINDOW)}</span>` : ''}
      ${goalNote}
    </div>
    <p class="gc-note dim">${m.note}</p>
  </section>`;
}

function addCard(today: string): string {
  const m = tr(M).add;
  return `
  <section class="game-card wt-add">
    <div class="gc-title">${m.title}</div>
    <div class="nt-field-row">
      <label class="nt-field">${m.weight(wUnit())}
        <input class="inp" id="wtKg" type="text" inputmode="decimal" autocomplete="off" placeholder="${units() === 'imperial' ? '180' : '82.4'}">
      </label>
      <label class="nt-field">${m.date}
        <input class="inp" id="wtDate" type="date" value="${today}" max="${today}">
      </label>
      <label class="nt-field">${m.time}
        <input class="inp" id="wtTime" type="time">
      </label>
    </div>
    <label class="nt-field">${m.note} <span class="gc-sub">${m.optional}</span>
      <input class="inp wt-note-inp" id="wtNote" type="text" maxlength="${WEIGHT_MAX_NOTE_LEN}" autocomplete="off"
        placeholder="${esc(m.notePlaceholder)}">
    </label>
    <button class="action-btn" id="wtAdd" type="button">${m.submit}</button>
    <p class="gc-note" id="wtAddMsg" role="status"></p>
    <p class="gc-note dim">${m.tip}</p>
  </section>`;
}

const HISTORY_MAX = 60;

function historyCard(all: readonly WeightRow[]): string {
  if (all.length === 0) return '';
  const m = tr(M).history;
  const newestFirst = [...all].reverse().slice(0, HISTORY_MAX);
  const min = all.reduce((m, r) => Math.min(m, r.kg), Number.POSITIVE_INFINITY);
  const max = all.reduce((m, r) => Math.max(m, r.kg), Number.NEGATIVE_INFINITY);
  const rows = newestFirst
    .map((r) => {
      const idx = all.indexOf(r);
      const prev = idx > 0 ? all[idx - 1] : undefined;
      const d = prev ? Math.round((r.kg - prev.kg) * 100) / 100 : null;
      // Where this weigh-in sits between the lightest and heaviest ever — a
      // hairline, so the list reads as a shape and not only as digits.
      const pos = max > min ? Math.round(((r.kg - min) / (max - min)) * 100) : 100;
      return `
    <li class="wt-row ${idx === all.length - 1 ? 'latest' : ''}">
      <div class="wt-row-top">
        <div class="wt-row-main">
          <span class="wt-row-date">${esc(fmtDate(r.date))}${r.time ? ` <span class="dim">${esc(r.time)}</span>` : ''}</span>
          ${r.note ? `<span class="wt-row-note dim">${esc(r.note)}</span>` : ''}
        </div>
        <div class="wt-row-nums">
          <span class="wt-row-kg">${fmtWeight(r.kg)}</span>
          <span class="wt-row-d">${d === null ? '' : fmtDelta(d)}</span>
          <button class="nt-del" type="button" data-del="${esc(r.id)}" aria-label="${esc(m.deleteAria(fmtDate(r.date)))}">🗑</button>
        </div>
      </div>
      <div class="wt-pos" aria-hidden="true" title="${m.posTitle}"><i style="width:${pos}%"></i></div>
    </li>`;
    })
    .join('');
  const more =
    all.length > HISTORY_MAX
      ? `<p class="gc-note dim">${m.more(HISTORY_MAX, all.length)}</p>`
      : all.length > 5
        ? `<p class="gc-note dim">${m.scroll}</p>`
        : '';
  return `
  <section class="game-card">
    <div class="gc-title">${m.title} <span class="gc-sub">${all.length}</span></div>
    <ul class="wt-list">${rows}</ul>
    ${more}
  </section>`;
}

function targetCard(target: number | null): string {
  const m = tr(M).target;
  return `
  <section class="game-card wt-target">
    <div class="gc-title">${m.title} <span class="gc-sub">${m.optional}</span></div>
    <label class="nt-field">${m.field(wUnit())}
      <input class="inp" id="wtTgt" type="text" inputmode="decimal" autocomplete="off"
        value="${target === null ? '' : fmtWeight(target)}" placeholder="—">
    </label>
    <button class="action-btn" id="wtTgtSave" type="button">${m.save}</button>
    <p class="gc-note" id="wtTgtMsg" role="status"></p>
    <p class="gc-note dim">${m.note}</p>
  </section>`;
}

/** The whole screen as a string — pure, testable without a DOM. */
export function weightHtml(n: NutritionState, today: string): string {
  const all = weightEntries(n);
  return `
  ${summaryCard(weightSummary(n), n.weightTarget, all[0]?.kg ?? null)}
  ${chartCard(all, n.weightTarget)}
  ${addCard(today)}
  ${historyCard(all)}
  ${targetCard(n.weightTarget)}`;
}

/* ----------------------------------------------------------------- render */

export function renderWeight(main: HTMLElement, deps: WeightDeps): void {
  const today = deps.today ?? todayISO();
  main.innerHTML = weightHtml(deps.store.getState().nutrition, today);
  wire(main, deps, today);
}

function refresh(main: HTMLElement, deps: WeightDeps): void {
  if (deps.rerender) deps.rerender();
  else renderWeight(main, deps);
}

/* ----------------------------------------------------------------- wiring */

/** The wall clock as 'HH:MM' — display data, so the UI may read the clock. */
function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * "82,4" and "82.4" both read as 82.4, "79.45" keeps its second decimal;
 * anything else is `null`. The number is typed in the DISPLAY unit and
 * converted to kilograms first (identity in metric), so the 20–400 kg bounds
 * and the two-decimal storage hold whatever the screen speaks: 180 lb is
 * stored as 81.65 kg and reads back as 180.0.
 */
function kgInput(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return null;
  const typed = Number(s);
  if (!Number.isFinite(typed)) return null;
  const n = displayToKg(typed);
  if (n < WEIGHT_MIN_KG || n > WEIGHT_MAX_KG) return null;
  return Math.round(n * 100) / 100;
}

/** The accepted range in the display unit, for the error lines: 20–400 kg, 45–881 lb. */
function boundsText(): [string, string] {
  if (units() !== 'imperial') return [String(WEIGHT_MIN_KG), String(WEIGHT_MAX_KG)];
  return [String(Math.ceil(WEIGHT_MIN_KG / KG_PER_LB)), String(Math.floor(WEIGHT_MAX_KG / KG_PER_LB))];
}

function wire(main: HTMLElement, deps: WeightDeps, today: string): void {
  const again = (): void => refresh(main, deps);

  /* ---- chart range ---- */
  main.querySelectorAll<HTMLButtonElement>('.wt-seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = btn.dataset['range'];
      range = r === 'all' ? 'all' : r === '10' ? 10 : 30;
      again();
    });
  });

  /* ---- delete an entry ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['del'];
      if (!id) return;
      if (!confirm(tr(M).confirmDelete)) return;
      deleteWeight(deps.store, id);
      again();
    });
  });

  /* ---- log a weigh-in ---- */
  const kgInp = main.querySelector<HTMLInputElement>('#wtKg');
  const dateInp = main.querySelector<HTMLInputElement>('#wtDate');
  const timeInp = main.querySelector<HTMLInputElement>('#wtTime');
  const noteInp = main.querySelector<HTMLInputElement>('#wtNote');
  const addMsg = main.querySelector<HTMLElement>('#wtAddMsg');

  main.querySelector<HTMLButtonElement>('#wtAdd')?.addEventListener('click', () => {
    const kg = kgInput(kgInp?.value ?? '');
    if (kg === null) {
      if (addMsg) addMsg.textContent = tr(M).err.weight(...boundsText(), wUnit());
      return;
    }
    const date = (dateInp?.value ?? '').trim() || today;
    if (!isCalendarDate(date) || date > today) {
      if (addMsg) addMsg.textContent = tr(M).err.date;
      return;
    }
    const typedTime = timeInp?.value && /^\d{2}:\d{2}$/.test(timeInp.value) ? timeInp.value : '';
    // No time typed: TODAY's weigh-in is stamped "now" — logging right off the
    // scale is the common case. On a past day "now" would be a lie.
    const time = typedTime !== '' ? typedTime : date === today ? nowHHMM() : '';
    const ev = logWeight(deps.store, { date, time, kg, note: (noteInp?.value ?? '').trim() }, crypto.randomUUID());
    if (!ev) {
      if (addMsg) addMsg.textContent = tr(M).err.failed;
      return;
    }
    toast(tr(M).toast.logged);
    again();
  });

  /* ---- goal weight ---- */
  const tgtMsg = main.querySelector<HTMLElement>('#wtTgtMsg');
  main.querySelector<HTMLButtonElement>('#wtTgtSave')?.addEventListener('click', () => {
    const raw = (main.querySelector<HTMLInputElement>('#wtTgt')?.value ?? '').trim();
    const kg = raw === '' ? null : kgInput(raw);
    if (raw !== '' && kg === null) {
      if (tgtMsg) tgtMsg.textContent = tr(M).err.target(...boundsText(), wUnit());
      return;
    }
    setWeightTarget(deps.store, kg);
    toast(kg === null ? tr(M).toast.targetCleared : tr(M).toast.targetSaved);
    again();
  });
}
