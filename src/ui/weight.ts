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
  isCalendarDate,
  logWeight,
  movingAverage,
  setWeightTarget,
  weightEntries,
  weightSummary,
  type WeightRow,
  type WeightSummary,
} from '../core/weight.ts';
import type { DataStore, NutritionState } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';

export interface WeightDeps {
  store: DataStore;
  /** Repaint header + main in place (no scroll reset). Absent in bare tests. */
  rerender?: () => void;
  /** Injectable for tests. */
  today?: string;
}

/** How many of the newest entries the chart shows. */
export type WeightRange = 10 | 30 | 'all';
export const WEIGHT_RANGES: readonly { key: WeightRange; label: string }[] = [
  { key: 10, label: '10 אחרונות' },
  { key: 30, label: '30 אחרונות' },
  { key: 'all', label: 'הכל' },
] as const;

/* -------------------------------------------------------- screen-local state */

/** The chart's range. In memory only, like a hub's last tab. */
let range: WeightRange = 30;

/** Forget everything screen-local (tests, and a data wipe). */
export function resetWeightScreen(): void {
  range = 30;
}

/* ------------------------------------------------------------- formatting */

const KG = 'ק״ג';

/** "82.4" — always one decimal, so a column of weights lines up. */
export function fmtKg(kg: number): string {
  return kg.toFixed(1);
}

/**
 * "+0.4" / "−0.6" / "±0.0", as one LTR run so the sign stays in front of the
 * digits inside an RTL sentence. Direction is NOT coloured: down is the goal
 * of a cut and up the goal of a bulk, and the tracker does not presume which.
 */
export function fmtDelta(d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `<span class="wt-delta" dir="ltr">${sign}${Math.abs(d).toFixed(1)}</span>`;
}

/** The header's one line under the title. */
export function weightHeadline(n: NutritionState): string {
  const s = weightSummary(n);
  if (!s.latest) return 'עוד לא נרשמה שקילה — הראשונה נרשמת במסך הזה';
  const change = s.sincePrevious === null ? '' : ` · ${plainDelta(s.sincePrevious)} מהשקילה הקודמת`;
  return `אחרון: ${fmtKg(s.latest.kg)} ${KG}${change}`;
}

/** `fmtDelta` without markup, for `textContent` slots (the header line). */
function plainDelta(d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `⁦${sign}${Math.abs(d).toFixed(1)}⁩`;
}

/* ------------------------------------------------------------------ chart */

const CHART_W = 320;
const CHART_H = 150;
const PAD_X = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 12;
/** The right-hand gutter for the y labels — a Hebrew line starts there. */
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
  const plotLeft = PAD_X;
  const plotRight = CHART_W - LABEL_W - PAD_X;
  const plotW = plotRight - plotLeft;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const step = n > 1 ? plotW / (n - 1) : 0;
  // i = 0 is the OLDEST entry and sits at the right edge of the plot: time
  // runs with the reading direction, which in Hebrew is right to left.
  const x = (i: number): number => Math.round((plotRight - i * step) * 10) / 10;
  const y = (kg: number): number => Math.round((PAD_TOP + (1 - (kg - lo) / (hi - lo)) * plotH) * 10) / 10;
  const baseline = PAD_TOP + plotH;

  const points = rows.map((r, i) => `${x(i)},${y(r.kg)}`);
  const line = `M${points.join(' L')}`;
  const area = n > 1 ? `${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z` : '';

  // Three hairlines with their values on the right: top, middle, bottom.
  const grid = [hi, round1((hi + lo) / 2), lo]
    .map(
      (v) =>
        `<line class="wt-grid" x1="${plotLeft}" y1="${y(v)}" x2="${plotRight}" y2="${y(v)}"/>` +
        `<text class="wt-ylab" x="${CHART_W - 2}" y="${y(v) + 3}" text-anchor="end">${fmtKg(v)}</text>`,
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
        `<title>${esc(when)} · ${fmtKg(r.kg)} ${KG}${r.note ? ` · ${esc(r.note)}` : ''}</title></circle>` +
        `<circle class="wt-pt" cx="${x(i)}" cy="${y(r.kg)}" r="2"/>`
      );
    })
    .join('');
  const last = rows[n - 1];
  const lastDot = last ? `<circle class="wt-dot" cx="${x(n - 1)}" cy="${y(last.kg)}" r="4.5"/>` : '';

  return `<svg class="chart wt-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img"
    aria-label="משקל ב־${n} השקילות האחרונות, מ־${fmtKg(lo)} עד ${fmtKg(hi)} ${KG}">
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

function summaryCard(s: WeightSummary): string {
  if (!s.latest) {
    return `
  <section class="game-card wt-summary">
    <div class="gc-title">המשקל שלי</div>
    <p class="empty">עוד לא נרשמה שקילה — הראשונה נרשמת למטה 👇</p>
  </section>`;
  }
  const stat = (label: string, d: number | null): string =>
    `<div class="wt-stat"><span class="wt-stat-val">${d === null ? '<span class="dim">—</span>' : fmtDelta(d)}</span><span class="wt-stat-lab">${label}</span></div>`;
  const goal =
    s.toTarget === null
      ? ''
      : s.targetReached
        ? `<p class="gc-note wt-goal-note ok">🎯 היעד הושג — ${fmtKg(s.latest.kg)} ${KG}!</p>`
        : `<p class="gc-note wt-goal-note">🎯 עוד ${fmtKg(Math.abs(s.toTarget))} ${KG} ליעד</p>`;
  return `
  <section class="game-card wt-summary">
    <div class="gc-title">המשקל שלי <span class="gc-sub">${esc(fmtDate(s.latest.date))}${s.latest.time ? ` · ${esc(s.latest.time)}` : ''}</span></div>
    <div class="wt-current"><b>${fmtKg(s.latest.kg)}</b> <span class="wt-unit">${KG}</span>
      ${s.trend !== null && s.count >= 3 ? `<span class="wt-trend-val dim">מגמה ${fmtKg(s.trend)}</span>` : ''}
    </div>
    <div class="wt-stats">
      ${stat('מהקודמת', s.sincePrevious)}
      ${stat('7 ימים', s.sevenDay)}
      ${stat('30 ימים', s.thirtyDay)}
      ${stat('מההתחלה', s.sinceFirst)}
    </div>
    ${goal}
  </section>`;
}

function rangeSeg(): string {
  return `<div class="wt-range" role="group" aria-label="טווח הגרף">${WEIGHT_RANGES.map(
    (r) =>
      `<button class="wt-seg ${r.key === range ? 'active' : ''}" type="button" data-range="${r.key}"
        aria-pressed="${r.key === range ? 'true' : 'false'}">${r.label}</button>`,
  ).join('')}</div>`;
}

function chartCard(all: readonly WeightRow[], target: number | null): string {
  if (all.length === 0) return '';
  const shown = range === 'all' ? all : all.slice(-range);
  const trendAll = movingAverage(all);
  const trend = trendAll.slice(all.length - shown.length);
  const { lo, hi } = chartRange(shown, target);
  const goalNote =
    target === null
      ? ''
      : target < lo || target > hi
        ? `<span class="cl-item dim">יעד ${fmtKg(target)} ${KG} — מחוץ לטווח הגרף</span>`
        : `<span class="cl-item"><i class="dot goal"></i>יעד <b>${fmtKg(target)} ${KG}</b></span>`;
  return `
  <section class="game-card wt-chart-card">
    <div class="gc-title">📈 מגמת המשקל <span class="gc-sub">${shown.length} שקילות</span></div>
    ${rangeSeg()}
    ${weightChartSvg(shown, trend, target)}
    <div class="chart-legend">
      <span class="cl-item"><i class="dot"></i>משקל</span>
      ${shown.length >= 3 ? `<span class="cl-item"><i class="dot trend"></i>ממוצע ${WEIGHT_TREND_WINDOW} שקילות</span>` : ''}
      ${goalNote}
    </div>
    <p class="gc-note dim">הזמן זורם מימין לשמאל — השקילה האחרונה בקצה השמאלי. כל נקודה היא שקילה אחת.</p>
  </section>`;
}

function addCard(today: string): string {
  return `
  <section class="game-card wt-add">
    <div class="gc-title">רישום שקילה</div>
    <div class="nt-field-row">
      <label class="nt-field">משקל (${KG})
        <input class="inp" id="wtKg" type="text" inputmode="decimal" autocomplete="off" placeholder="82.4">
      </label>
      <label class="nt-field">תאריך
        <input class="inp" id="wtDate" type="date" value="${today}" max="${today}">
      </label>
      <label class="nt-field">שעה
        <input class="inp" id="wtTime" type="time">
      </label>
    </div>
    <label class="nt-field">הערה <span class="gc-sub">לא חובה</span>
      <input class="inp wt-note-inp" id="wtNote" type="text" maxlength="${WEIGHT_MAX_NOTE_LEN}" autocomplete="off"
        placeholder="למשל: בבוקר, אחרי אימון">
    </label>
    <button class="action-btn" id="wtAdd" type="button">רישום</button>
    <p class="gc-note" id="wtAddMsg" role="status"></p>
    <p class="gc-note dim">הכי מדויק: אותה שעה, אותם תנאים — למשל כל בוקר לפני הארוחה.</p>
  </section>`;
}

const HISTORY_MAX = 60;

function historyCard(all: readonly WeightRow[]): string {
  if (all.length === 0) return '';
  const newestFirst = [...all].reverse().slice(0, HISTORY_MAX);
  const rows = newestFirst
    .map((r) => {
      const idx = all.indexOf(r);
      const prev = idx > 0 ? all[idx - 1] : undefined;
      const d = prev ? round1(r.kg - prev.kg) : null;
      return `
    <li class="wt-row">
      <div class="wt-row-main">
        <span class="wt-row-date">${esc(fmtDate(r.date))}${r.time ? ` <span class="dim">${esc(r.time)}</span>` : ''}</span>
        ${r.note ? `<span class="wt-row-note dim">${esc(r.note)}</span>` : ''}
      </div>
      <div class="wt-row-nums">
        <span class="wt-row-kg">${fmtKg(r.kg)}</span>
        <span class="wt-row-d">${d === null ? '' : fmtDelta(d)}</span>
        <button class="nt-del" type="button" data-del="${esc(r.id)}" aria-label="מחיקת השקילה מ־${esc(fmtDate(r.date))}">🗑</button>
      </div>
    </li>`;
    })
    .join('');
  const more = all.length > HISTORY_MAX ? `<p class="gc-note dim">מוצגות ${HISTORY_MAX} השקילות האחרונות מתוך ${all.length}.</p>` : '';
  return `
  <section class="game-card">
    <div class="gc-title">השקילות שלי <span class="gc-sub">${all.length}</span></div>
    <ul class="wt-list">${rows}</ul>
    ${more}
  </section>`;
}

function targetCard(target: number | null): string {
  return `
  <section class="game-card wt-target">
    <div class="gc-title">משקל יעד <span class="gc-sub">לא חובה</span></div>
    <label class="nt-field">יעד (${KG})
      <input class="inp" id="wtTgt" type="text" inputmode="decimal" autocomplete="off"
        value="${target === null ? '' : fmtKg(target)}" placeholder="—">
    </label>
    <button class="action-btn" id="wtTgtSave" type="button">שמירת יעד</button>
    <p class="gc-note" id="wtTgtMsg" role="status"></p>
    <p class="gc-note dim">היעד מצויר כקו על הגרף. ריק = בלי יעד.</p>
  </section>`;
}

/** The whole screen as a string — pure, testable without a DOM. */
export function weightHtml(n: NutritionState, today: string): string {
  const all = weightEntries(n);
  return `
  ${summaryCard(weightSummary(n))}
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

/** "82,4" and "82.4" both read as 82.4; anything else is `null`. */
function kgInput(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < WEIGHT_MIN_KG || n > WEIGHT_MAX_KG) return null;
  return Math.round(n * 10) / 10;
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
      if (!confirm('למחוק את השקילה? הנקודה תוסר מהגרף.')) return;
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
      if (addMsg) addMsg.textContent = `המשקל צריך להיות מספר בין ${WEIGHT_MIN_KG} ל־${WEIGHT_MAX_KG} ${KG}.`;
      return;
    }
    const date = (dateInp?.value ?? '').trim() || today;
    if (!isCalendarDate(date) || date > today) {
      if (addMsg) addMsg.textContent = 'התאריך לא תקין — ושקילה לא יכולה להיות בעתיד.';
      return;
    }
    const typedTime = timeInp?.value && /^\d{2}:\d{2}$/.test(timeInp.value) ? timeInp.value : '';
    // No time typed: TODAY's weigh-in is stamped "now" — logging right off the
    // scale is the common case. On a past day "now" would be a lie.
    const time = typedTime !== '' ? typedTime : date === today ? nowHHMM() : '';
    const ev = logWeight(deps.store, { date, time, kg, note: (noteInp?.value ?? '').trim() }, crypto.randomUUID());
    if (!ev) {
      if (addMsg) addMsg.textContent = 'לא הצלחנו לרשום את השקילה — בדקו את הפרטים.';
      return;
    }
    toast('השקילה נרשמה ⚖️');
    again();
  });

  /* ---- goal weight ---- */
  const tgtMsg = main.querySelector<HTMLElement>('#wtTgtMsg');
  main.querySelector<HTMLButtonElement>('#wtTgtSave')?.addEventListener('click', () => {
    const raw = (main.querySelector<HTMLInputElement>('#wtTgt')?.value ?? '').trim();
    const kg = raw === '' ? null : kgInput(raw);
    if (raw !== '' && kg === null) {
      if (tgtMsg) tgtMsg.textContent = `היעד צריך להיות מספר בין ${WEIGHT_MIN_KG} ל־${WEIGHT_MAX_KG} ${KG} (או ריק).`;
      return;
    }
    setWeightTarget(deps.store, kg);
    toast(kg === null ? 'היעד הוסר' : 'היעד נשמר 🎯');
    again();
  });
}
