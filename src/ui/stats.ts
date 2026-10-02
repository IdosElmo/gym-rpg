/**
 * ui/stats.ts — the 📊 סטטיסטיקות screen (view `SS`), third inner tab of the
 * ⚙️ הגדרות hub.
 *
 * The numbers all come from `core/stats.ts`, which is pure; this file is only
 * the drawing, and it draws with THE APP'S OWN TOKENS — `--bg`, `--card`,
 * `--card-2`, `--line`, `--accent`, `--ok`, `--warn` — so the screen belongs to
 * the same app as the rest.
 *
 * ---------------------------------------------------------------------------
 * THE CHART CONVENTIONS THIS FILE SETS (there were none before it)
 * ---------------------------------------------------------------------------
 * 1. INLINE SVG, NO LIBRARY. Every chart is a handful of `<path>` / `<rect>`
 *    elements built as a string, like every other screen in this app. A chart
 *    library would be the first runtime dependency in the bundle and the build
 *    is a single self-contained file (`npm run verify`) — so, no.
 *
 * 2. ONE HUE PER CHART. Magnitude is drawn as one colour getting stronger
 *    (`--accent` at increasing opacity), never as a rainbow: a heat scale with
 *    six hues would say "these are six different KINDS of day", which is false.
 *    `--ok` / `--warn` stay reserved for what they already mean elsewhere in the
 *    app (good / attention), and never become "series 2".
 *
 * 3. TIME FLOWS WITH THE READING DIRECTION. In Hebrew (RTL) reading starts at the
 *    right edge, so time does too. The sparkline's oldest week is at the RIGHT
 *    and the live week at the LEFT; the heatmap's oldest column is at the right
 *    and THIS week is the leftmost column, right where the eye lands last —
 *    which is the same place a left-to-right reader finds "now" in a GitHub
 *    contribution graph. SVG has no `direction`, so both charts compute their x
 *    coordinates in that order explicitly rather than relying on layout.
 *    The heatmap's weekday letters (א–ש) sit on the RIGHT of the grid, because
 *    that is where a Hebrew line starts. In English (`isRtl()` false) all of it
 *    mirrors: oldest on the left, this week on the right, letters on the left.
 *    The rows stay Sunday-first in both languages: a column IS one of the
 *    game's Sunday–Saturday weeks, and reordering the rows would split it.
 *
 * 4. THIN MARKS, RECESSIVE CHROME. 2px lines, a 10–14% area wash, ≥8px end
 *    markers ringed in the surface colour, hairline solid baselines and no axes
 *    at all. Labels are HTML around the SVG rather than `<text>` inside it: the
 *    labels are Hebrew, SVG text has no bidi layout worth trusting, and HTML
 *    labels stay selectable and scale with the user's font size.
 *
 * 5. NOTHING IS INTERACTIVE. The cards are read, not pressed — so there is no
 *    tap target to get wrong on a phone. Every cell and every point still
 *    carries a native `<title>`, which is the tooltip on a desktop and the
 *    accessible name everywhere.
 */

import { findExercise, type ExerciseResolver } from '../data/program.ts';
import { makeResolver } from '../core/plan.ts';
import { fmtDate, todayISO } from '../core/workout.ts';
import { computeStats, type HeatWeek, type Stats, type WeekPoint } from '../core/stats.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { isRtl, locale, tr } from '../i18n/locale.ts';
import { kgToDisplay, units } from '../i18n/units.ts';
import { weekdayName, weekdayShort } from '../i18n/format.ts';
import { bodyPartName, exLoadUnit, exName } from '../i18n/content.ts';
import { stats as M } from '../i18n/messages/stats.ts';

export interface StatsDeps {
  store: DataStore;
  /** ISO "today" — injectable so a test can pin the calendar. */
  today?: string;
}

/**
 * The weight unit this screen prints: the catalog's kilogram label (the
 * gershayim `ק״ג` in Hebrew, as the screen always printed it), or `lb`.
 */
function unitLabel(): string {
  return units() === 'imperial' ? 'lb' : tr(M).kg;
}

/** Stored kilograms -> a display-unit integer with its label ("1,234 ק״ג"). */
function weightText(kg: number): string {
  return `${fmtInt(kgToDisplay(kg))} ${unitLabel()}`;
}

/**
 * An exercise's name on this screen. Hebrew prints the name the stats carry
 * (resolved when they were computed); English looks the exercise up again to
 * read its translated name, falling back to that same string.
 */
type NameOf = (exId: string, he: string) => string;

function namer(resolve: ExerciseResolver): NameOf {
  return (exId, he) => {
    if (locale() === 'he') return he;
    const ex = resolve(exId);
    return ex ? exName(ex) : he;
  };
}

/* -------------------------------------------------------------- numbers */

/** Thousands-separated integer. `1234.5` -> `"1,235"`. */
export function fmtInt(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  return v.toLocaleString('en-US');
}

/**
 * A number for reading rather than for auditing: thousands separated, and one
 * decimal only while the value is small enough for that decimal to mean
 * anything (a headline of "123,456.7 ק״ג" is noise, "12.5 ק״ג" is not).
 */
export function fmtNum(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) >= 1000 || Number.isInteger(v)) return fmtInt(v);
  return (Math.round(v * 10) / 10).toLocaleString('en-US');
}

/** Seconds -> "3 שעות ו‑12 דקות" / "45 דקות" / "50 שניות" ("3 hours and 12 minutes"). */
export function fmtDuration(seconds: number): string {
  const d = tr(M).dur;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return d.seconds(s);
  const minutes = Math.round(s / 60);
  if (minutes < 60) return d.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = d.hours(hours, fmtInt(hours));
  return rest > 0 ? d.hoursMinutes(hoursText, rest) : hoursText;
}

/** A percentage with its sign — growth is a story, and the sign tells it. */
function fmtPct(p: number): string {
  return `${p > 0 ? '+' : ''}${fmtInt(p)}%`;
}

/**
 * "42.5 × 10" — always LTR, like every other number pair in the app.
 *
 * `cardioUnit` is the cardio load's own unit ("%", "W") when the set is a
 * cardio stage — its load is an incline or a resistance, never a weight, so it
 * is the one number here that never turns into pounds.
 */
function fmtSet(weight: number, reps: number, timed: boolean, cardioUnit: string | null = null): string {
  const m = tr(M).set;
  // a cardio stage: its load in its own unit, and minutes — never kilograms
  if (cardioUnit !== null) return m.cardio(fmtNum(weight), cardioUnit, fmtNum(reps));
  const w = `${fmtNum(kgToDisplay(weight))} ${unitLabel()}`;
  if (timed) return `${m.timed(fmtNum(reps))}${weight > 0 ? ` · ${w}` : ''}`;
  if (weight <= 0) return m.reps(fmtNum(reps));
  return `${w} × ${fmtNum(reps)}`;
}

/* ----------------------------------------------------------- the cards */

/** 💪 The headline: everything you have ever lifted, and what that weighs. */
function heroCard(stats: Stats): string {
  const m = tr(M);
  const { headline, next, all } = stats.equivalents;
  const rungs = all
    .map(
      (r) => `<li class="eq ${r.reached ? 'on' : ''}">
      <span class="eq-emoji" aria-hidden="true">${r.eq.emoji}</span>
      <b class="eq-count">${fmtNum(r.count)}</b>
      <span class="eq-name">${esc(m.eqCount(r.eq, r.count))}</span>
    </li>`,
    )
    .join('');

  return `
  <section class="game-card stats-hero">
    <h3 class="gc-title">${m.hero.title} <span class="gc-sub">${m.hero.sub}</span></h3>
    <p class="hero-num"><b>${fmtInt(kgToDisplay(stats.basics.tonnage))}</b> <span class="hero-unit">${unitLabel()}</span></p>
    ${
      headline
        ? `<p class="hero-eq">${m.hero.eq(headline.eq.emoji, fmtNum(headline.count), esc(m.eqCount(headline.eq, headline.count)))}</p>`
        : `<p class="hero-eq">${m.hero.first}</p>`
    }
    ${
      next
        ? `<p class="gc-note">${m.hero.next(weightText(next.remaining), esc(m.eqGoal(next.eq)), next.eq.emoji)}</p>`
        : `<p class="gc-note">${m.hero.top}</p>`
    }
    <ul class="eq-list">${rungs}</ul>
  </section>`;
}

/** The plain counters — the ones a training app owes its user. */
function basicsCard(stats: Stats): string {
  const m = tr(M).basics;
  const b = stats.basics;
  const g = stats.game;
  const weekday = b.topWeekday === null ? '—' : weekdayName(b.topWeekday) || '—';
  const tiles: Array<[string, string]> = [
    [m.workouts, fmtInt(b.workouts)],
    [m.sets, fmtInt(b.sets)],
    [m.reps, fmtInt(b.reps)],
    [m.plankSeconds, fmtInt(b.seconds)],
    // a tile that is always 0 for a lifter is noise — it appears with the first cardio stage
    ...(b.cardioMinutes > 0 ? [[m.cardioMinutes, fmtNum(b.cardioMinutes)] as [string, string]] : []),
    [m.prs, fmtInt(g.prs)],
    [m.perWeek, fmtNum(b.perWeek)],
    [m.streak, fmtInt(g.streakTier)],
    [m.bestStreak, fmtInt(g.bestStreakTier)],
    [m.topDay, weekday],
  ];
  return `
  <section class="game-card">
    <h3 class="gc-title">${m.title}
      <span class="gc-sub">${b.firstDate ? m.since(fmtDate(b.firstDate)) : m.notYet}</span>
    </h3>
    <div class="stat-grid stats-tiles">
      ${tiles.map(([k, v]) => `<div class="stat"><span class="s-k">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
    </div>
  </section>`;
}

/* ------------------------------------------------------- the sparkline */

const SPARK_W = 320;
const SPARK_H = 96;
const SPARK_PAD_X = 10;
const SPARK_PAD_TOP = 12;
const SPARK_PAD_BOTTOM = 12;

/**
 * The 12-week tonnage line — one series, so no legend: the card title says
 * what is plotted, and a one-swatch legend box would only restate it.
 *
 * Oldest week at the reading START — the RIGHT in Hebrew, the left in English
 * (see the header of this file). The current week is the last point and is
 * drawn with the end marker, because it is the one number still moving.
 */
export function sparklineSvg(weeks: readonly WeekPoint[]): string {
  const n = weeks.length;
  if (n === 0) return '';
  const m = tr(M).spark;
  const max = weeks.reduce((acc, w) => Math.max(acc, w.tonnage), 0);
  const plotW = SPARK_W - SPARK_PAD_X * 2;
  const plotH = SPARK_H - SPARK_PAD_TOP - SPARK_PAD_BOTTOM;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const baseline = SPARK_PAD_TOP + plotH;
  // i = 0 is the OLDEST week and sits at the reading start: time runs with the
  // reading direction — right to left in Hebrew, left to right in English.
  const rtl = isRtl();
  const x = (i: number): number =>
    Math.round((rtl ? SPARK_W - SPARK_PAD_X - i * step : SPARK_PAD_X + i * step) * 10) / 10;
  const y = (v: number): number =>
    Math.round((max > 0 ? SPARK_PAD_TOP + (1 - v / max) * plotH : baseline) * 10) / 10;

  const points = weeks.map((w, i) => `${x(i)},${y(w.tonnage)}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`;
  const lastX = x(n - 1);
  const lastY = y(weeks[n - 1]?.tonnage ?? 0);

  const dots = weeks
    .map(
      (w, i) =>
        `<circle class="sp-hit" cx="${x(i)}" cy="${y(w.tonnage)}" r="3">` +
        `<title>${esc(m.point(fmtDate(w.weekStart), weightText(w.tonnage), fmtInt(w.sets), w.sets))}</title></circle>`,
    )
    .join('');

  return `<svg class="chart spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" role="img"
    aria-label="${esc(m.aria(n))}">
    <line class="sp-base" x1="${SPARK_PAD_X}" y1="${baseline}" x2="${SPARK_W - SPARK_PAD_X}" y2="${baseline}"/>
    <path class="sp-area" d="${area}"/>
    <path class="sp-line" d="${line}"/>
    ${dots}
    <circle class="sp-dot" cx="${lastX}" cy="${lastY}" r="4"/>
  </svg>`;
}

function weeklyCard(stats: Stats): string {
  const m = tr(M).weekly;
  const weeks = stats.weekly;
  const values = weeks.map((w) => w.tonnage);
  const max = values.reduce((acc, v) => Math.max(acc, v), 0);
  const min = values.reduce((acc, v) => Math.min(acc, v), Number.POSITIVE_INFINITY);
  const current = weeks[weeks.length - 1];
  const peak = weeks.find((w) => w.tonnage === max);
  return `
  <section class="game-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub(weeks.length)}</span></h3>
    ${sparklineSvg(weeks)}
    <div class="chart-legend">
      <span class="cl-item"><i class="dot live"></i>${m.live}<b>${weightText(current?.tonnage ?? 0)}</b></span>
      <span class="cl-item">${m.peak}<b>${weightText(max)}</b>${peak ? ` · ${esc(fmtDate(peak.weekStart))}` : ''}</span>
      <span class="cl-item">${m.low}<b>${weightText(Number.isFinite(min) ? min : 0)}</b></span>
    </div>
    <p class="gc-note dim">${m.direction}</p>
  </section>`;
}

/* --------------------------------------------------------- the heatmap */

const CELL = 13;
const CELL_GAP = 3;
const CELL_STEP = CELL + CELL_GAP;
const LABEL_W = 16;

/**
 * The calendar. In Hebrew the newest week is the LEFTMOST column and the
 * weekday letters sit on the right of the grid, because a Hebrew line starts on
 * the right; in English it mirrors — letters on the left, oldest week first,
 * this week on the right.
 *
 * The gap between cells is the surface showing through — no cell ever gets a
 * border, which would add ink that is not data.
 */
export function heatmapSvg(weeks: readonly HeatWeek[]): string {
  const m = tr(M).heat;
  const n = weeks.length;
  const gridW = n * CELL_STEP - CELL_GAP;
  const width = gridW + LABEL_W;
  const height = 7 * CELL_STEP - CELL_GAP;
  const rtl = isRtl();
  // Hebrew: newest first, column 0 drawn at x = 0 (the LEFT edge), labels to
  // the right of the grid. English: oldest first, after the labels' gutter.
  const columns = rtl ? [...weeks].reverse() : [...weeks];
  const gridX = rtl ? 0 : LABEL_W;

  const cells = columns
    .map((week, c) =>
      week.days
        .map((d, r) => {
          const cls = `hm-cell l${d.level}${d.future ? ' future' : ''}`;
          const label = d.future
            ? m.future(fmtDate(d.date))
            : m.day(fmtDate(d.date), d.sets, d.tonnage > 0 ? weightText(d.tonnage) : '');
          return `<rect class="${cls}" x="${gridX + c * CELL_STEP}" y="${r * CELL_STEP}" width="${CELL}" height="${CELL}" rx="3">
            <title>${esc(label)}</title></rect>`;
        })
        .join(''),
    )
    .join('');

  const labelX = rtl ? gridW + 5 : 0;
  const labels = [0, 1, 2, 3, 4, 5, 6]
    .map(
      (r) =>
        `<text class="hm-day" x="${labelX}" y="${r * CELL_STEP + CELL - 3}">${esc(weekdayShort(r))}</text>`,
    )
    .join('');

  return `<svg class="chart heat" viewBox="0 0 ${width} ${height}" role="img"
    aria-label="${esc(m.aria(n))}">${cells}${labels}</svg>`;
}

function heatmapCard(stats: Stats): string {
  const m = tr(M).heat;
  const days = stats.heatmap.flatMap((w) => w.days);
  const trained = days.filter((d) => d.sets > 0).length;
  const swatches = [0, 1, 2, 3, 4].map((l) => `<i class="hm-key l${l}"></i>`).join('');
  return `
  <section class="game-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub(stats.heatmap.length, trained)}</span></h3>
    <div class="chart-wrap">${heatmapSvg(stats.heatmap)}</div>
    <div class="chart-legend hm-legend">
      <span class="cl-item">${m.scale(swatches)}</span>
      <span class="cl-item dim">${m.now}</span>
    </div>
  </section>`;
}

/* --------------------------------------------------- body-part balance */

function balanceCard(stats: Stats): string {
  const m = tr(M).balance;
  const b = stats.balance;
  const rows = b.parts
    .map((p) => {
      const pct = Math.round(p.ratio * 100);
      const share = b.total > 0 ? Math.round((p.volume / b.total) * 100) : 0;
      const tag =
        p.part === b.most
          ? `<span class="bal-tag most">${m.most}</span>`
          : p.part === b.least
            ? `<span class="bal-tag least">${m.least}</span>`
            : '';
      return `
      <div class="bal-row" data-part="${p.part}">
        <div class="part-head">
          <span class="part-name">${esc(bodyPartName(p.part))}${tag}</span>
          <span class="part-level">${share}%</span>
        </div>
        <div class="part-bar"><span style="width:${pct}%"></span></div>
        <div class="part-foot">
          <span>${m.points(fmtInt(p.volume))}</span>
          <span class="part-xp">${p.tonnage > 0 ? weightText(p.tonnage) : m.bodyweight}</span>
        </div>
      </div>`;
    })
    .join('');

  const most = b.most ? bodyPartName(b.most) : '';
  const least = b.least ? bodyPartName(b.least) : '';
  return `
  <section class="game-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub}</span></h3>
    <div class="parts bal-parts">${rows}</div>
    ${
      b.most && b.least && b.most !== b.least
        ? `<p class="gc-note">${m.note(esc(most), esc(least))}</p>`
        : `<p class="gc-note">${m.empty}</p>`
    }
    <p class="gc-note dim">${m.definition}</p>
  </section>`;
}

/* ------------------------------------------------------ exercise bests */

function bestsCard(stats: Stats, nameOf: NameOf, resolve: ExerciseResolver): string {
  if (stats.bests.length === 0) return '';
  const m = tr(M).bests;
  const rows = stats.bests
    .map((e) => {
      // A cardio best is a load in its own unit ("%"), in the reader's words.
      const ex = e.cardio ? resolve(e.exId) : null;
      const cardioUnit = e.cardio ? (ex ? exLoadUnit(ex) : e.cardio.loadUnit) : null;
      return `
      <tr>
        <td class="ex">${esc(nameOf(e.exId, e.he))}<span class="ex-sub">${m.sub(fmtInt(e.sets), fmtInt(e.sessions))}</span></td>
        <td class="num">${esc(fmtSet(e.best.weight, e.best.reps, e.timed, cardioUnit))}</td>
        <td class="num">${esc(fmtSet(e.first.weight, e.first.reps, e.timed, cardioUnit))}</td>
        <td class="grow ${e.growthPct !== null && e.growthPct > 0 ? 'up' : ''}">${
          e.growthPct === null ? '—' : m.growth(fmtPct(e.growthPct))
        }</td>
      </tr>`;
    })
    .join('');
  return `
  <section class="game-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.count(stats.bests.length)}</span></h3>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th>${m.exercise}</th><th>${m.best}</th><th>${m.first}</th><th>${m.change}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

/* --------------------------------------------------------- game stats */

function gameCard(stats: Stats): string {
  const m = tr(M).game;
  const g = stats.game;
  const tiles: Array<[string, string]> = [
    [m.waves, fmtInt(g.wavesCleared)],
    [m.miniBosses, fmtInt(g.miniBosses)],
    [m.worldBosses, fmtInt(g.worldBosses)],
    [m.dailies, fmtInt(g.dailyCompleted)],
    [m.dailyBest, fmtInt(g.dailyBestScore)],
    [m.duels, `${fmtInt(g.duelWins)}‑${fmtInt(g.duelLosses)}`],
    [m.coinsEarned, fmtInt(g.coinsEarned)],
    [m.coinsSpent, fmtInt(g.coinsSpent)],
    [m.energy, fmtInt(g.energyEarned)],
  ];
  return `
  <section class="game-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub}</span></h3>
    <div class="stat-grid stats-tiles">
      ${tiles.map(([k, v]) => `<div class="stat"><span class="s-k">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
    </div>
    <p class="gc-note">${m.phone(fmtInt(g.energyEarned), fmtNum(g.phoneCharges))}</p>
  </section>`;
}

/* ----------------------------------------------------------- oddballs */

function oddCard(stats: Stats, nameOf: NameOf): string {
  const m = tr(M).odd;
  const o = stats.odd;
  const items: string[] = [];

  items.push(
    `<li><span class="odd-k">${m.rest}</span><b>${esc(fmtDuration(o.restSeconds))}</b>
      <span class="odd-note">${m.restNote}</span></li>`,
  );

  if (o.heaviestSet) {
    const h = o.heaviestSet;
    items.push(
      `<li><span class="odd-k">${m.heaviest}</span><b>${esc(fmtSet(h.weight, h.reps, h.timed))}</b>
        <span class="odd-note">${esc(nameOf(h.exId, h.he))} · ${esc(fmtDate(h.date))}</span></li>`,
    );
  }

  if (o.xpPerTon !== null) {
    // "Per ton" is per 1,000 of the DISPLAY unit — a metric tonne, or 1,000 lb.
    const value =
      units() === 'imperial'
        ? m.xpPerThousand(fmtNum((o.xpPerTon * 1000) / kgToDisplay(1000)), unitLabel())
        : m.xpPerTon(fmtNum(o.xpPerTon));
    items.push(
      `<li><span class="odd-k">${m.xp}</span><b>${value}</b>
        <span class="odd-note">${m.xpNote(unitLabel())}</span></li>`,
    );
  }

  if (o.loyal) {
    items.push(
      `<li><span class="odd-k">${m.loyal}</span><b>${esc(nameOf(o.loyal.exId, o.loyal.he))}</b>
        <span class="odd-note">${m.loyalNote(fmtInt(o.loyal.sessions))}</span></li>`,
    );
  }

  if (o.longestGap) {
    items.push(
      `<li><span class="odd-k">${m.gap}</span><b>${m.gapDays(fmtInt(o.longestGap.days))}</b>
        <span class="odd-note">${m.gapNote(esc(fmtDate(o.longestGap.from)), esc(fmtDate(o.longestGap.to)))}</span></li>`,
    );
  }

  return `
  <section class="game-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub}</span></h3>
    <ul class="odd-list">${items.join('')}</ul>
  </section>`;
}

/* ------------------------------------------------------------- screen */

/** Nothing logged yet — the one card the screen shows on a fresh install. */
function emptyCard(): string {
  const m = tr(M).empty;
  return `
  <section class="game-card stats-empty">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub}</span></h3>
    <p class="gc-note">${m.note}</p>
    <p class="gc-note dim">${m.local}</p>
  </section>`;
}

/**
 * The whole screen as HTML — pure, so a test can render it without a store.
 *
 * The order is deliberate: the one number everybody came for, then the plain
 * counters, then the two time charts, then the "where is my training going"
 * cards, and the game layer last — this is the training screen of the app, and
 * the RPG is the reward on top of it.
 *
 * `resolve` only matters in English, to name an exercise in the reader's
 * language (the stats carry the Hebrew name they were computed with).
 */
export function statsHtml(stats: Stats, resolve: ExerciseResolver = findExercise): string {
  if (stats.empty) return `${emptyCard()}${gameCard(stats)}`;
  const nameOf = namer(resolve);
  return [
    heroCard(stats),
    basicsCard(stats),
    weeklyCard(stats),
    heatmapCard(stats),
    balanceCard(stats),
    bestsCard(stats, nameOf, resolve),
    gameCard(stats),
    oddCard(stats, nameOf),
  ].join('');
}

export function renderStats(main: HTMLElement, deps: StatsDeps): void {
  const state = deps.store.getState();
  // The plan-aware resolver, like the history screen: an exercise the user
  // invented still shows its own name here.
  const resolve = makeResolver(state.plan);
  main.innerHTML = statsHtml(
    computeStats({
      sessions: state.sessions,
      events: deps.store.getEvents(),
      resolve,
      today: deps.today ?? todayISO(),
    }),
    resolve,
  );
}
