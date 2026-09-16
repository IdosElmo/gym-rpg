/**
 * ui/nutrition.ts — the 🍽️ תזונה screen: the meal tracker.
 *
 * A TRACKER, NOT A GAME SCREEN: nothing here grants XP, energy or coins — the
 * cards read `state.nutrition` and the drivers in core/nutrition.ts append
 * tracker events (`meal_logged` / `meal_deleted` / `nutrition_targets_set`)
 * that the game reducer never sees.
 *
 * THE ✨ GEMINI BUTTON IS ABSENT, NOT DISABLED. `deps.ai` arrives only from a
 * build whose composition root wired the Supabase Edge Function port, and the
 * button renders only while `ai.configured()` (= signed in). Everything else on
 * the screen — logging, deleting, targets, history — is fully offline.
 *
 * GEMINI SUGGESTS, NEVER WRITES: an estimate only PREFILLS the calories/protein
 * fields (by poking the live inputs — no re-render, so nothing typed is lost);
 * the meal enters the log exclusively through the הוספה button. If the numbers
 * are still the model's when the user saves, the meal is stamped with its
 * source + confidence for the 🤖 marker AND the priced breakdown it was shown,
 * so the meal list can unfold it again later; edit either number and it is
 * yours — `manual` again, nothing stored.
 *
 * THE PICTURES. The day's summary is two rings that fill toward the targets
 * (`ringHtml`), and the history is a bar chart of daily intake with the mean
 * over tracked days (`intakeChartSvg`) — inline SVG strings in the
 * ui/weight.ts conventions: one hue, digits-only SVG text, time right → left.
 */

import { fmtDate, todayISO } from '../core/workout.ts';
import {
  MEAL_MAX_CALORIES,
  MEAL_MAX_PROTEIN,
  dayTotals,
  deleteMeal,
  intakeStats,
  logMeal,
  mealsForDate,
  recentDays,
  setTargets,
  shiftDate,
  type DaySummary,
  type MealInput,
  type MealRow,
} from '../core/nutrition.ts';
import type { EstimateError, EstimateItem, MealEstimate, NutritionAiPort } from '../nutrition/aiPort.ts';
import { downscalePhoto } from '../nutrition/photo.ts';
import type { DataStore, MealAiInfo, MealAiItem, MealSource, NutritionState, NutritionTargets } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';

export interface NutritionDeps {
  store: DataStore;
  /** Repaint header + main in place (no scroll reset). Absent in bare tests. */
  rerender?: () => void;
  /** The estimation port. Absent = the ✨ button does not exist. */
  ai?: NutritionAiPort;
  /** Injectable for tests. */
  today?: string;
}

/** One Hebrew line per way an estimate can fail. */
export const ESTIMATE_ERROR_HE: Readonly<Record<EstimateError, string>> = {
  signed_out: 'הערכת קלוריות דורשת התחברות לחשבון (במסך ההגדרות) — או הזנה ידנית.',
  offline: 'אין חיבור לאינטרנט — אפשר להזין קלוריות ידנית.',
  rate_limited: 'יותר מדי בקשות — נסו שוב בעוד רגע.',
  http: 'השרת לא ענה — נסו שוב.',
  unparseable: 'לא הצלחנו להבין את התשובה — נסו לנסח אחרת או להזין ידנית.',
};

export const CONFIDENCE_HE: Readonly<Record<MealEstimate['confidence'], string>> = {
  low: 'נמוך',
  medium: 'בינוני',
  high: 'גבוה',
};

/** "4 דפים דף אורז" → the quantity and the name, as one stored/spoken label. */
function itemLabel(it: EstimateItem): string {
  return it.quantity ? `${it.quantity} ${it.name}` : it.name;
}

/** The line as it is stored on the meal — the estimator's shape, field for field. */
function storedItem(it: EstimateItem): MealAiItem {
  return { name: it.name, quantity: it.quantity, grams: it.grams, kcal: it.kcal, proteinG: it.proteinG, assumed: it.assumed };
}

/** The estimate's breakdown — one row per ingredient, ⚠️ where the quantity was assumed. */
export function breakdownHtml(items: readonly MealAiItem[]): string {
  return items
    .map((it) => {
      const nums =
        it.kcal !== null && it.proteinG !== null
          ? `<span class="nt-bd-nums">${it.grams ?? 0} ג׳ · 🔥 ${it.kcal} · 💪 ${it.proteinG} ג׳</span>`
          : '';
      const badge = it.assumed ? `<span class="nt-assumed">⚠️ כמות משוערת</span>` : '';
      return `<li class="nt-bd-row ${it.assumed ? 'assumed' : ''}">
        <span class="nt-bd-name">${esc(it.name)}${it.quantity ? ` <span class="dim">${esc(it.quantity)}</span>` : ''}${badge}</span>
        ${nums}
      </li>`;
    })
    .join('');
}

/* -------------------------------------------------------- screen-local state */

/** The day on screen; `null` = today. In memory only, like a hub's last tab. */
let viewDate: string | null = null;
/** A photo attached and downscaled, waiting for ✨ (or discarded). */
let photo: { mimeType: string; base64: string } | null = null;
/** The last estimate — so a save whose numbers are untouched keeps its byline. */
let lastEstimate: { estimate: MealEstimate; source: MealSource } | null = null;
/** The intake chart's window and number. In memory only, like a hub's last tab. */
let chartRange: IntakeRange = 7;
let chartMetric: IntakeMetric = 'calories';

/** Forget everything screen-local (tests, and a data wipe). */
export function resetNutritionScreen(): void {
  viewDate = null;
  photo = null;
  lastEstimate = null;
  chartRange = 7;
  chartMetric = 'calories';
}

/* ------------------------------------------------------------ the rings */

/** The ring's geometry: r=40 in a 100-unit box, a 10-unit stroke. */
const RING_R = 40;
const RING_CIRC = Math.round(2 * Math.PI * RING_R * 10) / 10;

/**
 * One donut that fills toward a daily target. The share is capped at a full
 * turn; past the target the ring turns `--warn` (over target IS "attention")
 * and the surplus is spelled out under the number. Without a target the track
 * is dashed and the number simply sits in the middle — the ring cannot fill
 * toward nothing, and the card says where to set one.
 */
export function ringHtml(kind: 'cal' | 'prot', value: number, target: number | null): string {
  const has = target !== null && target > 0;
  const pct = has ? Math.min(1, value / target) : 0;
  const over = has && value > target;
  const offset = Math.round(RING_CIRC * (1 - pct) * 10) / 10;
  const label = kind === 'cal' ? 'קלוריות' : 'גרם חלבון';
  const emoji = kind === 'cal' ? '🔥' : '💪';
  const sub = !has
    ? `<span class="nt-ring-sub dim">ללא יעד</span>`
    : over
      ? `<span class="nt-ring-sub over">+${value - target} מעל היעד</span>`
      : `<span class="nt-ring-sub">נותרו ${target - value}</span>`;
  const pctText = has ? `${Math.round((value / target) * 100)}%` : '';
  const aria = has ? `${label}: ${value} מתוך ${target}` : `${label}: ${value}`;
  return `
    <div class="nt-ring ${has ? 'has-target' : 'no-target'} ${over ? 'over' : ''}" role="img" aria-label="${esc(aria)}">
      <svg viewBox="0 0 100 100" class="nt-ring-svg" aria-hidden="true">
        <circle class="nt-ring-track" cx="50" cy="50" r="${RING_R}"/>
        ${
          has
            ? `<circle class="nt-ring-fill" cx="50" cy="50" r="${RING_R}"
          style="--circ:${RING_CIRC};stroke-dasharray:${RING_CIRC};stroke-dashoffset:${offset}"/>`
            : ''
        }
        <text class="nt-ring-val" x="50" y="${pctText ? 49 : 55}" text-anchor="middle">${value}</text>
        ${pctText ? `<text class="nt-ring-pct" x="50" y="64" text-anchor="middle">${pctText}</text>` : ''}
      </svg>
      <span class="nt-ring-lab">${emoji} ${label}${has ? ` <span class="dim">/ ${target}</span>` : ''}</span>
      ${sub}
    </div>`;
}

function totalsCard(n: NutritionState, date: string, today: string): string {
  const t = dayTotals(n, date);
  const g = n.targets;
  const noTargets = g.calories === null && g.protein === null;
  const protPct = g.protein !== null && g.protein > 0 ? Math.round((t.protein / g.protein) * 100) : null;
  const status =
    t.meals === 0
      ? 'עוד לא תועדו ארוחות ביום הזה'
      : noTargets
        ? 'הגדירו יעדים יומיים למטה — והעיגולים יתמלאו לפי ההתקדמות'
        : g.calories !== null && t.calories > g.calories
          ? 'עברתם את יעד הקלוריות — שווה לבדוק מה אפשר להוריד מחר'
          : protPct !== null && protPct >= 100
            ? 'יעד החלבון הושג 💪'
            : g.calories !== null && t.calories >= g.calories * 0.9
              ? 'כמעט ביעד הקלוריות — עוד ארוחה קטנה ודי'
              : 'ממשיכים לתעד — כל ארוחה נכנסת לעיגולים';
  return `
  <section class="game-card nt-totals">
    <div class="gc-title">סיכום ${date === today ? 'היום' : 'היום הזה'} <span class="gc-sub">${t.meals === 0 ? 'אין ארוחות' : `${t.meals} ארוחות`}</span></div>
    <div class="nt-rings">
      ${ringHtml('cal', t.calories, g.calories)}
      ${ringHtml('prot', t.protein, g.protein)}
    </div>
    <p class="gc-note nt-status">${status}</p>
  </section>`;
}

/* ------------------------------------------------------------- the meals */

/** The estimate's byline, e.g. "🤖 הערכת Gemini · דיוק בינוני". */
function aiByline(ai: MealAiInfo): string {
  return `🤖 הערכת ${esc(ai.model === 'gemini' ? 'Gemini' : ai.model)} · דיוק ${CONFIDENCE_HE[ai.confidence]}`;
}

/**
 * What the estimator saw, kept on the meal: the priced breakdown when it was
 * stored, otherwise the bare ingredient labels of an older meal. Folded under a
 * ▸ so the list stays a list.
 */
function mealDetailsHtml(row: MealRow): string {
  const ai = row.ai;
  if (!ai) return '';
  const body =
    ai.breakdown && ai.breakdown.length > 0
      ? `<ul class="nt-breakdown">${breakdownHtml(ai.breakdown)}</ul>`
      : ai.items.length > 0
        ? `<p class="nt-items">${ai.items.map((it) => `<span class="nt-chip">${esc(it)}</span>`).join('')}</p>`
        : `<p class="gc-note dim">ההערכה לא כללה פירוט מרכיבים.</p>`;
  const why = ai.reason ? `<p class="gc-note nt-reason">${esc(ai.reason)}</p>` : '';
  return `
    <details class="nt-meal-more">
      <summary class="nt-meal-sum"><span class="nt-caret" aria-hidden="true">▸</span>${aiByline(ai)}</summary>
      ${body}
      ${why}
    </details>`;
}

function mealRowHtml(row: MealRow, dayCalories: number): string {
  const conf = row.ai ? ` conf-${row.ai.confidence}` : '';
  const aiMark = row.ai
    ? `<span class="nt-ai${conf}" title="הוערך על ידי ${esc(row.ai.model)} · דיוק ${CONFIDENCE_HE[row.ai.confidence]}">🤖</span>`
    : '';
  const share = dayCalories > 0 ? Math.round((row.calories / dayCalories) * 100) : 0;
  return `
  <li class="nt-meal">
    <div class="nt-meal-row">
      <div class="nt-meal-main">
        <span class="nt-meal-name">${esc(row.name)}${aiMark}</span>
        ${row.time ? `<span class="nt-meal-time dim">🕒 ${esc(row.time)}</span>` : ''}
      </div>
      <div class="nt-meal-nums">
        <span class="nt-num">🔥 ${row.calories}</span>
        <span class="nt-num">💪 ${row.protein} ג׳</span>
        <button class="nt-del" type="button" data-del="${esc(row.id)}" aria-label="מחיקת ${esc(row.name)}">🗑</button>
      </div>
    </div>
    <div class="nt-share" title="${share}% מהקלוריות של היום" aria-hidden="true"><i style="width:${share}%"></i></div>
    ${mealDetailsHtml(row)}
  </li>`;
}

function mealsCard(n: NutritionState, date: string): string {
  const rows = mealsForDate(n, date);
  const total = rows.reduce((s, r) => s + r.calories, 0);
  const body =
    rows.length === 0
      ? `<p class="empty">לא תועדו ארוחות ביום הזה — הארוחה הראשונה נרשמת למטה 👇</p>`
      : `<ul class="nt-meals">${rows.map((r) => mealRowHtml(r, total)).join('')}</ul>`;
  const hasAi = rows.some((r) => r.ai);
  return `
  <section class="game-card">
    <div class="gc-title">הארוחות של היום${hasAi ? ` <span class="gc-sub">🤖 = הערכת Gemini</span>` : ''}</div>
    ${body}
  </section>`;
}

/* ------------------------------------------------------------ the add form */

function addCard(showAi: boolean, date: string, today: string): string {
  const aiRow = showAi
    ? `
    <div class="nt-est-row">
      <button class="action-btn" id="ntEst" type="button">✨ הערכה עם Gemini</button>
      <button class="action-btn ghost" id="ntPhotoBtn" type="button" aria-label="צירוף תמונת ארוחה">📷</button>
      <input type="file" id="ntPhoto" accept="image/*" hidden>
    </div>
    <p class="gc-note" id="ntPhotoNote" hidden>📷 תמונה צורפה <button class="nt-photo-clear" id="ntPhotoClear" type="button">הסרה</button></p>
    <p class="gc-note" id="ntEstMsg" role="status"></p>
    <ul class="nt-breakdown" id="ntEstBreakdown" hidden></ul>`
    : '';
  // On a past day the card says WHERE the meal will land — a forgotten dinner
  // is logged onto yesterday, not silently onto today.
  const dayNote = date === today ? '' : ` <span class="gc-sub">ליום ${esc(fmtDate(date))}</span>`;
  return `
  <section class="game-card nt-add">
    <div class="gc-title">הוספת ארוחה${dayNote}</div>
    <label class="nt-field">תיאור הארוחה
      <textarea class="inp nt-textarea" id="ntName" rows="3" maxlength="300" autocomplete="off"
        placeholder="למשל: טוסט עם 2 פרוסות גבינה צהובה וקופסת טונה אחת — ככל שהתיאור מפורט יותר (כמויות, אופן הכנה), ההערכה מדויקת יותר"></textarea>
    </label>
    ${aiRow}
    <div class="nt-field-row">
      <label class="nt-field">קלוריות
        <input class="inp" id="ntCal" type="text" inputmode="numeric" autocomplete="off" placeholder="0">
      </label>
      <label class="nt-field">חלבון (גרם)
        <input class="inp" id="ntProt" type="text" inputmode="numeric" autocomplete="off" placeholder="0">
      </label>
      <label class="nt-field">שעה
        <input class="inp" id="ntTime" type="time">
      </label>
    </div>
    <button class="action-btn" id="ntAdd" type="button">הוספה</button>
    <p class="gc-note" id="ntAddMsg" role="status"></p>
  </section>`;
}

/* -------------------------------------------------------------- the chart */

/** How many days the intake chart shows, and which number. */
export type IntakeRange = 7 | 14 | 30;
export type IntakeMetric = 'calories' | 'protein';
export const INTAKE_RANGES: readonly { key: IntakeRange; label: string }[] = [
  { key: 7, label: 'שבוע' },
  { key: 14, label: 'שבועיים' },
  { key: 30, label: 'חודש' },
] as const;
export const INTAKE_METRICS: readonly { key: IntakeMetric; label: string }[] = [
  { key: 'calories', label: '🔥 קלוריות' },
  { key: 'protein', label: '💪 חלבון' },
] as const;

const CHART_W = 320;
const CHART_H = 150;
const PAD_X = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 18;
/** The right-hand gutter for the y labels — a Hebrew line starts there. */
const LABEL_W = 36;

/** A "nice" ceiling for the y axis: the top of the data (or a line) plus air, rounded up. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 100;
  const raw = max * 1.12;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const unit = mag / 2;
  return Math.ceil(raw / unit) * unit;
}

/**
 * The intake bars. `days` are oldest first; i = 0 sits at the RIGHT edge, so
 * time runs with the reading direction (right to left), as the weight chart
 * does. An untracked day gets no bar — only a tick at the baseline — because
 * "nothing logged" is not "zero eaten". The dashed accent line is the mean
 * over tracked days; the dashed `--ok` line is the daily target when one is
 * set and fits. Today's bar is the solid one; the rest are one shade quieter.
 */
export function intakeChartSvg(
  days: readonly DaySummary[],
  metric: IntakeMetric,
  average: number | null,
  target: number | null,
  today: string,
): string {
  const n = days.length;
  if (n === 0) return '';
  const val = (d: DaySummary): number => (metric === 'calories' ? d.calories : d.protein);
  const dataMax = days.reduce((m, d) => Math.max(m, val(d)), 0);
  const top = niceCeiling(Math.max(dataMax, average ?? 0, target ?? 0));
  const plotLeft = PAD_X;
  const plotRight = CHART_W - LABEL_W - PAD_X;
  const plotW = plotRight - plotLeft;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotH;
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(22, Math.round(slot * 0.62 * 10) / 10));
  const gap = (slot - barW) / 2;
  const r = Math.min(4, barW / 2);
  const cx = (i: number): number => Math.round((plotRight - i * slot - slot / 2) * 10) / 10;
  const y = (v: number): number => Math.round((PAD_TOP + (1 - v / top) * plotH) * 10) / 10;
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  const unit = metric === 'calories' ? 'קלוריות' : 'ג׳ חלבון';

  const grid = [top, top / 2]
    .map(
      (v) =>
        `<line class="nt-grid" x1="${plotLeft}" y1="${y(v)}" x2="${plotRight}" y2="${y(v)}"/>` +
        `<text class="nt-ylab" x="${plotRight + LABEL_W / 2 + PAD_X / 2}" y="${y(v) + 3}" text-anchor="middle">${Math.round(v)}</text>`,
    )
    .join('') + `<line class="nt-grid base" x1="${plotLeft}" y1="${baseline}" x2="${plotRight}" y2="${baseline}"/>`;

  // Day-of-month under every bar for a week, every other for a fortnight,
  // every fifth for a month — digits only, the one SVG text bidi leaves alone.
  const labelEvery = n <= 7 ? 1 : n <= 14 ? 2 : 5;
  const bars = days
    .map((d, i) => {
      const v = val(d);
      const left = round1(cx(i) - barW / 2);
      const dom = String(Number(d.date.slice(8, 10)));
      const showLabel = (n - 1 - i) % labelEvery === 0;
      const xlab = showLabel
        ? `<text class="nt-xlab ${d.date === today ? 'today' : ''}" x="${cx(i)}" y="${CHART_H - 4}" text-anchor="middle">${dom}</text>`
        : '';
      if (d.meals === 0) {
        return (
          `<rect class="nt-tick" x="${left}" y="${baseline - 1.5}" width="${barW}" height="3" rx="1.5"/>` +
          `<rect class="nt-hit" x="${round1(left - gap)}" y="${PAD_TOP}" width="${round1(slot)}" height="${plotH + PAD_BOTTOM}">` +
          `<title>${esc(fmtDate(d.date))} · לא תועד</title></rect>${xlab}`
        );
      }
      const h = Math.max(2, round1(baseline - y(v)));
      const topY = round1(baseline - h);
      // A rounded top, a flat foot anchored on the baseline.
      const path =
        `M${left},${baseline} V${round1(topY + r)} Q${left},${topY} ${round1(left + r)},${topY} ` +
        `H${round1(left + barW - r)} Q${round1(left + barW)},${topY} ${round1(left + barW)},${round1(topY + r)} V${baseline} Z`;
      const cls = d.date === today ? 'nt-bar-day today' : 'nt-bar-day';
      const direct = d.date === today ? `<text class="nt-vlab" x="${cx(i)}" y="${round1(topY - 4)}" text-anchor="middle">${v}</text>` : '';
      return (
        `<path class="${cls}" d="${path}"/>${direct}` +
        `<rect class="nt-hit" x="${round1(left - gap)}" y="${PAD_TOP}" width="${round1(slot)}" height="${plotH + PAD_BOTTOM}">` +
        `<title>${esc(fmtDate(d.date))} · ${v} ${unit} · ${d.meals} ארוחות</title></rect>${xlab}`
      );
    })
    .join('');

  const avgLine =
    average !== null
      ? `<line class="nt-avg" x1="${plotLeft}" y1="${y(average)}" x2="${plotRight}" y2="${y(average)}"/>`
      : '';
  const goalLine =
    target !== null && target > 0 && target <= top
      ? `<line class="nt-goal" x1="${plotLeft}" y1="${y(target)}" x2="${plotRight}" y2="${y(target)}"/>`
      : '';

  return `<svg class="chart nt-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img"
    aria-label="${unit} ב־${n} הימים האחרונים${average !== null ? `, ממוצע ${average}` : ''}">
    ${grid}
    ${goalLine}
    ${bars}
    ${avgLine}
  </svg>`;
}

function seg<K extends string | number>(
  items: readonly { key: K; label: string }[],
  active: K,
  attr: string,
  aria: string,
): string {
  return `<div class="nt-seg-row" role="group" aria-label="${aria}">${items
    .map(
      (it) =>
        `<button class="nt-seg ${it.key === active ? 'active' : ''}" type="button" data-${attr}="${it.key}"
        aria-pressed="${it.key === active ? 'true' : 'false'}">${it.label}</button>`,
    )
    .join('')}</div>`;
}

function chartCard(n: NutritionState, today: string): string {
  const days = recentDays(n, today, chartRange);
  const stats = intakeStats(days);
  const average = chartMetric === 'calories' ? stats.avgCalories : stats.avgProtein;
  const target = chartMetric === 'calories' ? n.targets.calories : n.targets.protein;
  const unit = chartMetric === 'calories' ? 'קלוריות' : 'ג׳';
  const legend =
    stats.tracked === 0
      ? `<p class="empty nt-chart-empty">עוד אין ימים עם רישום בטווח הזה — הגרף מתחיל מהארוחה הראשונה</p>`
      : `<div class="chart-legend">
      <span class="cl-item"><i class="dot"></i>צריכה יומית</span>
      <span class="cl-item"><i class="dot trend"></i>ממוצע <b>${average ?? 0} ${unit}</b> <span class="dim">(${stats.tracked} ימים עם רישום)</span></span>
      ${target !== null ? `<span class="cl-item"><i class="dot goal"></i>יעד <b>${target} ${unit}</b></span>` : ''}
    </div>`;
  return `
  <section class="game-card nt-chart-card">
    <div class="gc-title">📊 הצריכה לאורך זמן <span class="gc-sub">${chartRange} ימים אחרונים</span></div>
    ${seg(INTAKE_METRICS, chartMetric, 'metric', 'מה להציג')}
    ${seg(INTAKE_RANGES, chartRange, 'range', 'טווח הגרף')}
    ${intakeChartSvg(days, chartMetric, average, target, today)}
    ${legend}
    <p class="gc-note dim">הזמן זורם מימין לשמאל — היום בקצה השמאלי. יום בלי רישום נשאר ריק ולא נספר בממוצע.</p>
  </section>`;
}

/* ------------------------------------------------------------ the targets */

function targetsCard(targets: NutritionTargets): string {
  return `
  <section class="game-card nt-targets">
    <div class="gc-title">יעדים יומיים <span class="gc-sub">לא חובה</span></div>
    <div class="nt-field-row">
      <label class="nt-field">קלוריות ליום
        <input class="inp" id="ntTgtCal" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.calories ?? ''}" placeholder="—">
      </label>
      <label class="nt-field">חלבון ליום (גרם)
        <input class="inp" id="ntTgtProt" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.protein ?? ''}" placeholder="—">
      </label>
    </div>
    <button class="action-btn" id="ntTgtSave" type="button">שמירת יעדים</button>
    <p class="gc-note" id="ntTgtMsg" role="status"></p>
  </section>`;
}

function dayNav(date: string, today: string): string {
  return `
  <div class="nt-daynav">
    <button class="action-btn ghost" id="ntPrev" type="button">→ יום אחורה</button>
    <span class="nt-date"><b>${date === today ? 'היום' : esc(fmtDate(date))}</b></span>
    <button class="action-btn ghost" id="ntNext" type="button" ${date === today ? 'disabled' : ''}>יום קדימה ←</button>
  </div>`;
}

/** The whole screen as a string — pure, testable without a DOM. */
export function nutritionHtml(n: NutritionState, date: string, today: string, showAi: boolean): string {
  return `
  ${dayNav(date, today)}
  ${totalsCard(n, date, today)}
  ${mealsCard(n, date)}
  ${addCard(showAi, date, today)}
  ${chartCard(n, today)}
  ${targetsCard(n.targets)}`;
}

/* ----------------------------------------------------------------- render */

export function renderNutrition(main: HTMLElement, deps: NutritionDeps): void {
  const today = deps.today ?? todayISO();
  if (viewDate !== null && viewDate > today) viewDate = null;
  const date = viewDate ?? today;
  const showAi = deps.ai?.configured() === true;
  main.innerHTML = nutritionHtml(deps.store.getState().nutrition, date, today, showAi);
  wire(main, deps, date, today);
}

function refresh(main: HTMLElement, deps: NutritionDeps): void {
  if (deps.rerender) deps.rerender();
  else renderNutrition(main, deps);
}

/* ----------------------------------------------------------------- wiring */

/** The wall clock as 'HH:MM' — display data, so the UI may read the clock. */
function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function intOf(input: HTMLInputElement | null, max: number): number | null {
  const raw = (input?.value ?? '').trim();
  if (raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), max);
}

function wire(main: HTMLElement, deps: NutritionDeps, date: string, today: string): void {
  const again = (): void => refresh(main, deps);

  /* ---- day navigation ---- */
  main.querySelector<HTMLButtonElement>('#ntPrev')?.addEventListener('click', () => {
    viewDate = shiftDate(date, -1);
    again();
  });
  main.querySelector<HTMLButtonElement>('#ntNext')?.addEventListener('click', () => {
    const next = shiftDate(date, 1);
    viewDate = next >= today ? null : next;
    again();
  });

  /* ---- chart window + metric ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = Number(btn.dataset['range']);
      chartRange = r === 14 ? 14 : r === 30 ? 30 : 7;
      again();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      chartMetric = btn.dataset['metric'] === 'protein' ? 'protein' : 'calories';
      again();
    });
  });

  /* ---- delete a meal ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['del'];
      if (!id) return;
      if (!confirm('למחוק את הארוחה? הרישום יוסר מהסיכום היומי.')) return;
      deleteMeal(deps.store, id);
      again();
    });
  });

  /* ---- add a meal ---- */
  const nameInp = main.querySelector<HTMLTextAreaElement>('#ntName');
  const calInp = main.querySelector<HTMLInputElement>('#ntCal');
  const protInp = main.querySelector<HTMLInputElement>('#ntProt');
  const timeInp = main.querySelector<HTMLInputElement>('#ntTime');
  const addMsg = main.querySelector<HTMLElement>('#ntAddMsg');

  main.querySelector<HTMLButtonElement>('#ntAdd')?.addEventListener('click', () => {
    const name = (nameInp?.value ?? '').trim();
    const calories = intOf(calInp, MEAL_MAX_CALORIES);
    const protein = intOf(protInp, MEAL_MAX_PROTEIN);
    if (!name) {
      if (addMsg) addMsg.textContent = 'לארוחה צריך תיאור — גם מילה אחת מספיקה.';
      return;
    }
    if (calories === null || protein === null) {
      if (addMsg) addMsg.textContent = 'קלוריות וחלבון צריכים להיות מספרים.';
      return;
    }
    // The estimate's byline survives only while its numbers do.
    const est = lastEstimate;
    const fromAi = est !== null && est.estimate.calories === calories && est.estimate.proteinG === protein;
    const typedTime = timeInp?.value && /^\d{2}:\d{2}$/.test(timeInp.value) ? timeInp.value : '';
    const input: MealInput = {
      date,
      name,
      calories,
      protein,
      // No time typed: on TODAY the meal is stamped "now" — logging right after
      // eating is the common case. On a past day "now" would be a lie, so the
      // time stays empty unless the user says otherwise.
      time: typedTime !== '' ? typedTime : date === today ? nowHHMM() : '',
      source: fromAi ? est.source : 'manual',
      // The breakdown rides along WHOLE, so the meal list can reopen it later.
      ...(fromAi
        ? {
            ai: {
              model: 'gemini',
              confidence: est.estimate.confidence,
              items: est.estimate.items.map(itemLabel),
              ...(est.estimate.items.length > 0 ? { breakdown: est.estimate.items.map(storedItem) } : {}),
              ...(est.estimate.reason ? { reason: est.estimate.reason } : {}),
            },
          }
        : {}),
    };
    const ev = logMeal(deps.store, input, crypto.randomUUID());
    if (!ev) {
      if (addMsg) addMsg.textContent = 'לא הצלחנו לרשום את הארוחה — בדקו את הפרטים.';
      return;
    }
    lastEstimate = null;
    photo = null;
    toast('הארוחה נרשמה 🍽️');
    again();
  });

  /* ---- targets ---- */
  const tgtMsg = main.querySelector<HTMLElement>('#ntTgtMsg');
  main.querySelector<HTMLButtonElement>('#ntTgtSave')?.addEventListener('click', () => {
    const calRaw = (main.querySelector<HTMLInputElement>('#ntTgtCal')?.value ?? '').trim();
    const protRaw = (main.querySelector<HTMLInputElement>('#ntTgtProt')?.value ?? '').trim();
    const cal = calRaw === '' ? null : Number(calRaw);
    const prot = protRaw === '' ? null : Number(protRaw);
    if ((cal !== null && (!Number.isFinite(cal) || cal < 0)) || (prot !== null && (!Number.isFinite(prot) || prot < 0))) {
      if (tgtMsg) tgtMsg.textContent = 'היעדים צריכים להיות מספרים (או ריקים).';
      return;
    }
    setTargets(deps.store, {
      calories: cal === null ? null : Math.floor(cal),
      protein: prot === null ? null : Math.floor(prot),
    });
    toast('היעדים נשמרו');
    again();
  });

  /* ---- Gemini estimation (only rendered when the port says configured) ---- */
  const ai = deps.ai;
  const estBtn = main.querySelector<HTMLButtonElement>('#ntEst');
  const estMsg = main.querySelector<HTMLElement>('#ntEstMsg');
  const breakdown = main.querySelector<HTMLElement>('#ntEstBreakdown');
  const photoNote = main.querySelector<HTMLElement>('#ntPhotoNote');
  const photoInp = main.querySelector<HTMLInputElement>('#ntPhoto');

  const showPhotoNote = (): void => {
    if (photoNote) photoNote.hidden = photo === null;
  };
  showPhotoNote();

  main.querySelector<HTMLButtonElement>('#ntPhotoBtn')?.addEventListener('click', () => photoInp?.click());
  main.querySelector<HTMLButtonElement>('#ntPhotoClear')?.addEventListener('click', () => {
    photo = null;
    if (photoInp) photoInp.value = '';
    showPhotoNote();
  });
  photoInp?.addEventListener('change', () => {
    const file = photoInp.files?.[0];
    if (!file) return;
    void downscalePhoto(file)
      .then((p) => {
        photo = p;
        showPhotoNote();
      })
      .catch(() => {
        if (estMsg) estMsg.textContent = 'לא הצלחנו לקרוא את התמונה — נסו תמונה אחרת.';
      });
  });

  if (ai && estBtn) {
    estBtn.addEventListener('click', () => {
      const text = (nameInp?.value ?? '').trim();
      if (!text && !photo) {
        if (estMsg) estMsg.textContent = 'כתבו תיאור קצר או צרפו תמונה — ואז ✨.';
        return;
      }
      estBtn.disabled = true;
      const label = estBtn.textContent;
      estBtn.textContent = 'מעריך…';
      if (estMsg) estMsg.textContent = '';
      if (breakdown) {
        breakdown.hidden = true;
        breakdown.innerHTML = '';
      }
      void ai
        .estimate({ text, ...(photo ? { photo } : {}) })
        .then((result) => {
          if (!result.ok) {
            if (estMsg) estMsg.textContent = ESTIMATE_ERROR_HE[result.error];
            return;
          }
          const est = result.estimate;
          lastEstimate = { estimate: est, source: photo ? 'gemini_photo' : 'gemini_text' };
          // Prefill by poking the LIVE inputs — no re-render, nothing typed is lost.
          if (calInp) calInp.value = String(est.calories);
          if (protInp) protInp.value = String(est.proteinG);
          if (estMsg) {
            const names = est.items.map(itemLabel);
            const found = names.length > 0 ? `נמצא: ${names.join(', ')} · ` : '';
            // Anything short of high confidence says WHY, so the user knows what
            // to add to the description (a quantity, a preparation) and retry.
            const why = est.confidence !== 'high' && est.reason ? ` (${est.reason})` : '';
            estMsg.textContent = `${found}דיוק ${CONFIDENCE_HE[est.confidence]}${why} — אפשר לתקן לפני ההוספה.`;
          }
          // The breakdown IS the number: one line per ingredient, so the user
          // can see where the total came from and which line to pin down.
          if (breakdown) {
            breakdown.innerHTML = breakdownHtml(est.items);
            breakdown.hidden = est.items.length === 0;
          }
        })
        .finally(() => {
          estBtn.disabled = false;
          estBtn.textContent = label;
        });
    });
  }
}
