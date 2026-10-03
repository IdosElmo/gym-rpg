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
 * THE PICTURES. The day's summary is a calorie ring (`heroRingHtml` — what is
 * left, big, in its centre) beside a list of macro bars (`macroRowHtml` —
 * protein, carbs, fat; carbs and fat fill toward the default split of
 * core/macros.ts unless set, "≈" on the target, and read "≥" while any meal
 * of the day carries no value for them), and the history is a
 * bar chart of daily intake with the mean
 * over tracked days (`intakeChartSvg`) — inline SVG strings in the
 * ui/weight.ts conventions: one hue, digits-only SVG text, time right → left.
 *
 * WHOLE DAYS ONLY, AND AN HONEST MARGIN. "סגרתי את היום" marks a day's log as
 * complete (`nutrition_day_closed`); a closed day is LOCKED — no add, no
 * delete — until "פתיחה להוספה" reopens it, so a closed day's number never
 * moves by accident. The chart can average over closed days only, hiding the
 * half-logged ones. And because estimates run low (oil, sauces, portions), the
 * day's calories are also drawn at +10% and +20% (`SAFETY_MARGINS`) — two more
 * rings folded under a toggle, and a chart lens — display-only, nothing stored
 * changes.
 *
 * ONE METER CONTRACT. The ring and the bar are two drawings of the same thing —
 * a value filling toward a target — so both carry the same hooks: `.nt-ring`
 * with `has-target` / `no-target` / `over`, a `.nt-ring-fill` only when there
 * is a target to fill toward, and a `.nt-ring-sub` that says what is left (or
 * by how much it is over). The tests read the day through those hooks, in
 * order: the calorie ring, the macro bars, then the margin rings.
 *
 * STAGE ז — THE FOOD DATABASE. The catalog picker lists "ארוחות מוכנות" (ready
 * meals, everyone's) in their own group; "⭐ הארוחות שלי" is a one-tap strip of
 * the user's saved meals (`meal_template_saved`, saved with ☆ from a logged
 * meal or from the description form) and the owners' fixed meals they have
 * eaten; and a "🍱 תפריט לדוגמה" card shows the sample day closest to the
 * calorie target (core/menus.ts), each of its meals one ＋ away from the log —
 * a normal catalog pick. A logged catalog meal is named in the reader's
 * language from its stored ids (`loggedMealName`).
 */

import {
  PORTION,
  catalogEntry,
  catalogHints,
  catalogMealInput,
  entriesForSlot,
  myFixedMeals,
  parseQty,
  priceCatalog,
  readyForSlot,
  templateFromMeal,
  templateMealInput,
  unitsOf,
} from '../core/catalog.ts';
import { macroTargets } from '../core/macros.ts';
import { menuById, menuFor, menuTotals, priceItem } from '../core/menus.ts';
import {
  MEAL_MAX_CALORIES,
  MEAL_MAX_CARBS,
  MEAL_MAX_FAT,
  MEAL_MAX_PROTEIN,
  MEAL_SLOTS,
  SAFETY_MARGINS,
  dayMacros,
  dayTotals,
  deleteMeal,
  deleteTemplate,
  liveTemplates,
  intakeStats,
  isDayClosed,
  logMeal,
  mealsForDate,
  recentDays,
  saveTemplate,
  setDayClosed,
  setTargets,
  shiftDate,
  slotAt,
  withMargin,
  type DaySummary,
  type MealInput,
  type MealRow,
  type SafetyMargin,
  type TemplateInput,
  type TemplateRow,
} from '../core/nutrition.ts';
import { fmtDate, todayISO } from '../core/workout.ts';
import { DAILY_MENUS, FOODS, type CatalogEntry, type CatalogMeal, type DailyMenu } from '../data/foods.ts';
import type { EstimateError, EstimateItem, MealEstimate, NutritionAiPort } from '../nutrition/aiPort.ts';
import { downscalePhoto } from '../nutrition/photo.ts';
import type { PushPort, PushResult } from '../nutrition/push.ts';
import type {
  DataStore,
  MealAiInfo,
  MealAiItem,
  MealSlot,
  MealSource,
  NutritionState,
  NutritionTargets,
} from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { isRtl, tr } from '../i18n/locale.ts';
import { nutrition as M } from '../i18n/messages/nutrition.ts';
import {
  displayNames,
  entryName,
  loggedLines,
  loggedMealName,
  mealName,
  storedPickName,
  unitLabel,
} from '../i18n/foodText.ts';

export interface NutritionDeps {
  store: DataStore;
  /** Repaint header + main in place (no scroll reset). Absent in bare tests. */
  rerender?: () => void;
  /** The estimation port. Absent = the ✨ button does not exist. */
  ai?: NutritionAiPort;
  /** The 🔔 reminders port. Absent = the reminders card does not exist. */
  push?: PushPort;
  /** Injectable for tests. */
  today?: string;
  /** The wall clock as 'HH:MM' — picks today's default meal. Injectable for tests. */
  now?: () => string;
}

/** One Hebrew line per way an estimate can fail (kept for importers; the screen reads the locale's). */
export const ESTIMATE_ERROR_HE: Readonly<Record<EstimateError, string>> = M.he.estimateError;

export const CONFIDENCE_HE: Readonly<Record<MealEstimate['confidence'], string>> = M.he.confidence;

/** A meal of the day's heading / chip, in the reader's language (`MEAL_SLOTS` keeps the Hebrew). */
function slotLabel(key: MealSlot): string {
  return tr(M).slots[key].label;
}
function slotShort(key: MealSlot): string {
  return tr(M).slots[key].short;
}

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
  const m = tr(M).breakdown;
  return items
    .map((it) => {
      const nums =
        it.kcal !== null && it.proteinG !== null
          ? `<span class="nt-bd-nums">${m.nums(it.grams ?? 0, it.kcal, it.proteinG)}</span>`
          : '';
      const badge = it.assumed ? `<span class="nt-assumed">${m.assumed}</span>` : '';
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
/** Which days the chart shows and averages, and the under-estimation lens. */
let chartDays: IntakeDays = 'all';
let chartMargin: SafetyMargin = 0;
/** Whether the +10% / +20% rings are unfolded. In memory only, like the chart's lens. */
let marginsOpen = false;
/** The meal the form adds to; `null` = the default (today: by the clock; a past day: none). */
let addSlot: MealSlot | null = null;
/** Catalog pick or free text. The catalog is the measured way, so it opens first. */
let addMode: AddMode = 'catalog';
/** The catalog pick in progress: entry, unit, the quantity as typed, and "show all". */
let catPick = '';
let catUnit = '';
let catQty = '1';
let catAll = false;
/** "הארוחות שלי" — the fixed meals this user has logged before (`myFixedMeals`), refreshed every render. */
let myMeals: readonly CatalogMeal[] = [];
/** What is typed in the form, kept across re-renders (a chip tap re-renders). */
let draft = { name: '', cal: '', prot: '', carbs: '', fat: '', time: '' };
/** "⭐ לשמור גם בארוחות שלי" in the description form. */
let saveMine = false;
/** The sample menu picked by hand; `null` = the one closest to the calorie target. */
let menuPick: string | null = null;

/** Forget everything screen-local (tests, and a data wipe). */
export function resetNutritionScreen(): void {
  viewDate = null;
  photo = null;
  lastEstimate = null;
  chartRange = 7;
  chartMetric = 'calories';
  chartDays = 'all';
  chartMargin = 0;
  marginsOpen = false;
  addSlot = null;
  addMode = 'catalog';
  resetPick();
  draft = { name: '', cal: '', prot: '', carbs: '', fat: '', time: '' };
  saveMine = false;
  menuPick = null;
}

function resetPick(): void {
  catPick = '';
  catUnit = '';
  catQty = '1';
  catAll = false;
}

/* ------------------------------------------------------------ the rings */

/** The ring's geometry: r=40 in a 100-unit box, a 10-unit stroke. */
export const RING_R = 40;
export const RING_CIRC = Math.round(2 * Math.PI * RING_R * 10) / 10;

/**
 * One donut that fills toward a daily target. The share is capped at a full
 * turn; past the target the ring turns `--warn` (over target IS "attention")
 * and the surplus is spelled out under the number. Without a target the track
 * is dashed and the number simply sits in the middle — the ring cannot fill
 * toward nothing, and the card says where to set one.
 */
export function ringHtml(kind: 'cal' | 'prot', value: number, target: number | null, margin: SafetyMargin = 0): string {
  const has = target !== null && target > 0;
  const pct = has ? Math.min(1, value / target) : 0;
  const over = has && value > target;
  const offset = Math.round(RING_CIRC * (1 - pct) * 10) / 10;
  const m = tr(M).ring;
  // A margin ring names its lens; the "+" stays on the left of the digits in RTL.
  const label = margin > 0 ? `<bdi dir="ltr">+${margin}%</bdi>` : kind === 'cal' ? m.cal : m.prot;
  const ariaLabel = margin > 0 ? m.marginAria(margin) : kind === 'cal' ? m.cal : m.prot;
  const emoji = kind === 'cal' ? '🔥' : '💪';
  const sub = !has
    ? `<span class="nt-ring-sub dim">${m.noTarget}</span>`
    : over
      ? `<span class="nt-ring-sub over">${m.over(value - target)}</span>`
      : `<span class="nt-ring-sub">${m.left(target - value)}</span>`;
  const pctText = has ? `${Math.round((value / target) * 100)}%` : '';
  const aria = has ? m.aria(ariaLabel, value, target) : m.ariaNoTarget(ariaLabel, value);
  return `
    <div class="nt-ring ${has ? 'has-target' : 'no-target'} ${over ? 'over' : ''} ${margin > 0 ? 'margin' : ''}" role="img" aria-label="${esc(aria)}">
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

/**
 * THE day's calorie ring: what is LEFT, big, in the centre, read as one phrase
 * around the number ("נותרו / 730 / קק״ל"), and the eaten / target pair small
 * under it. Past the target the number is the surplus and the ring turns
 * `--warn`; without a target the number is what was eaten, the track is
 * dashed and the centre says there is no target. The share of the target sits
 * under the dial (`.nt-ring-pct`).
 */
export function heroRingHtml(value: number, target: number | null): string {
  const has = target !== null && target > 0;
  const over = has && value > target;
  const pct = has ? Math.min(1, value / target) : 0;
  const offset = Math.round(RING_CIRC * (1 - pct) * 10) / 10;
  const all = tr(M);
  const m = all.ring;
  const phrase = !has ? all.hero.eaten : over ? all.hero.over : all.hero.left;
  const big = !has ? String(value) : over ? `+${value - target}` : String(target - value);
  const word = (w: string): string => (w ? `<span class="nt-hero-w">${w}</span>` : '');
  const of = has
    ? `<span class="nt-hero-of"><bdi dir="ltr">${value} / ${target}</bdi></span>`
    : `<span class="nt-hero-of">${m.noTarget}</span>`;
  const aria = has ? m.aria(m.cal, value, target) : m.ariaNoTarget(m.cal, value);
  return `
    <div class="nt-ring nt-hero ${has ? 'has-target' : 'no-target'} ${over ? 'over' : ''}" role="img" aria-label="${esc(aria)}">
      <div class="nt-hero-dial">
        <svg viewBox="0 0 100 100" class="nt-ring-svg" aria-hidden="true">
          <circle class="nt-ring-track" cx="50" cy="50" r="${RING_R}"/>
          ${
            has
              ? `<circle class="nt-ring-fill" cx="50" cy="50" r="${RING_R}"
            style="--circ:${RING_CIRC};stroke-dasharray:${RING_CIRC};stroke-dashoffset:${offset}"/>`
              : ''
          }
        </svg>
        <div class="nt-hero-c">
          <span class="nt-ring-sub nt-hero-sub ${over ? 'over' : ''}">${word(phrase.before)}${phrase.before ? ' ' : ''}<b class="nt-hero-num"><bdi dir="ltr">${big}</bdi></b> ${word(phrase.after)}</span>
          ${of}
        </div>
      </div>
      ${has ? `<span class="nt-ring-pct">${Math.round((value / target) * 100)}%</span>` : ''}
    </div>`;
}

/** One macro bar: a name, eaten / target in grams, the bar, and what is left. */
export interface MacroSpec {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly target: number | null;
  /** The target is the default split (core/macros.ts), not one the user set — drawn "≈". */
  readonly derived?: boolean;
  /** How many of the day's meals carry no value for it — the value is a lower bound ("≥"). */
  readonly missing?: number;
}

/**
 * A macro as a bar — the ring's meter contract drawn flat (see the header):
 * `.nt-ring` + target state, a `.nt-ring-fill` only toward a target, and the
 * `.nt-ring-sub` line. Protein over its target is not a warning (eating more
 * protein than planned is rarely the problem), so the bar keeps its colour and
 * only the line says by how much.
 */
export function macroRowHtml(spec: MacroSpec): string {
  const { key, label, value, target } = spec;
  const missing = spec.missing ?? 0;
  const has = target !== null && target > 0;
  const over = has && value > target;
  const pct = has ? Math.round(Math.min(1, value / target) * 1000) / 10 : 0;
  const all = tr(M);
  const m = all.ring;
  const sub =
    missing > 0
      ? `<span class="nt-ring-sub dim nt-macro-missing">${all.macro.missing(missing)}</span>`
      : !has
        ? `<span class="nt-ring-sub dim">${m.noTarget}</span>`
        : over
          ? `<span class="nt-ring-sub over">${m.over(value - target)}</span>`
          : `<span class="nt-ring-sub">${m.left(target - value)}</span>`;
  // "≥" — a lower bound while a meal of the day lacks the value; "≈" — the default split.
  const shown = `${missing > 0 ? '≥' : ''}${value}`;
  const tgt = has ? `${spec.derived ? '≈' : ''}${target}` : '';
  const ariaLabel = missing > 0 ? `${label} (${all.macro.ariaPartial})` : label;
  const aria = has ? m.aria(ariaLabel, value, target) : m.ariaNoTarget(ariaLabel, value);
  const nums = has
    ? spec.derived
      ? `<bdi dir="ltr" title="${esc(all.macro.derived)}">${shown} / ${tgt}</bdi>`
      : `<bdi dir="ltr">${shown} / ${tgt}</bdi>`
    : missing > 0
      ? `<bdi dir="ltr">${shown}</bdi>`
      : shown;
  return `
      <div class="nt-ring nt-macro ${has ? 'has-target' : 'no-target'} ${over ? 'over' : ''}" data-macro="${esc(key)}" role="img" aria-label="${esc(aria)}">
        <div class="nt-macro-top">
          <span class="nt-macro-name">${esc(label)}</span>
          <span class="nt-macro-val">${all.macro.grams(nums)}</span>
        </div>
        <span class="nt-macro-track">${has ? `<i class="nt-ring-fill" style="inline-size:${pct}%"></i>` : ''}</span>
        ${sub}
      </div>`;
}

function totalsCard(n: NutritionState, date: string, today: string): string {
  const t = dayTotals(n, date);
  const closed = isDayClosed(n, date);
  const g = n.targets;
  const noTargets = g.calories === null && g.protein === null;
  const protPct = g.protein !== null && g.protein > 0 ? Math.round((t.protein / g.protein) * 100) : null;
  const m = tr(M).totals;
  // The bars beside the ring, in order: protein, then carbs and fat — whose
  // targets may be the default split, and whose totals may be lower bounds.
  const mt = macroTargets(g);
  const cf = dayMacros(n, date);
  const mm = tr(M).macro;
  const macros: MacroSpec[] = [
    { key: 'protein', label: mm.protein, value: t.protein, target: g.protein },
    { key: 'carbs', label: mm.carbs, value: cf.carbs, target: mt.carbs, derived: mt.derived.carbs, missing: cf.carbsMissing },
    { key: 'fat', label: mm.fat, value: cf.fat, target: mt.fat, derived: mt.derived.fat, missing: cf.fatMissing },
  ];
  const status =
    t.meals === 0
      ? m.empty
      : closed
        ? m.closed
        : noTargets
        ? m.noTargets
        : g.calories !== null && t.calories > g.calories
          ? m.overCal
          : protPct !== null && protPct >= 100
            ? m.protDone
            : g.calories !== null && t.calories >= g.calories * 0.9
              ? m.nearCal
              : m.keepGoing;
  return `
  <section class="game-card nt-totals">
    <div class="gc-title">${m.title(date === today)} <span class="gc-sub">${t.meals === 0 ? m.noMeals : m.meals(t.meals)}</span>${
      closed ? ` <span class="nt-closed-chip">${m.closedChip}</span>` : ''
    }</div>
    <div class="nt-summary">
      ${heroRingHtml(t.calories, g.calories)}
      <div class="nt-macros">
        ${macros.map(macroRowHtml).join('')}
      </div>
    </div>
    <details class="nt-margins" id="ntMargins" ${marginsOpen ? 'open' : ''}>
      <summary class="nt-margins-title"><span class="nt-caret" aria-hidden="true">▸</span>${m.marginsTitle}</summary>
      <div class="nt-rings">
        ${SAFETY_MARGINS.map((m) => ringHtml('cal', withMargin(t.calories, m), g.calories, m)).join('')}
      </div>
    </details>
    <p class="gc-note nt-status">${status}</p>
    ${
      t.meals > 0 && !closed
        ? `<button class="action-btn ghost nt-close-btn" id="ntClose" type="button">${m.closeBtn}</button>
    <p class="gc-note dim">${m.closeNote}</p>`
        : ''
    }
  </section>`;
}

/* ------------------------------------------------------------- the meals */

/** The estimate's byline, e.g. "🤖 הערכת Gemini · דיוק בינוני". */
function aiByline(ai: MealAiInfo): string {
  const m = tr(M);
  return m.meal.aiByline(esc(ai.model === 'gemini' ? 'Gemini' : ai.model), m.confidence[ai.confidence]);
}

/**
 * What stands behind a meal's numbers, folded under a ▸ so the list stays a
 * list: for a catalog pick, the priced lines it was summed from; for an
 * estimate, the priced breakdown when it was stored, otherwise the bare
 * ingredient labels of an older meal.
 */
function mealDetailsHtml(row: MealRow): string {
  const cat = row.catalog;
  if (row.source === 'catalog' && cat && cat.lines.length > 1) {
    return `
    <details class="nt-meal-more">
      <summary class="nt-meal-sum"><span class="nt-caret" aria-hidden="true">▸</span>${tr(M).meal.fromCatalogSum(cat.lines.length)}</summary>
      <ul class="nt-breakdown">${breakdownHtml(loggedLines(cat))}</ul>
    </details>`;
  }
  const ai = row.ai;
  if (!ai) return '';
  const body =
    ai.breakdown && ai.breakdown.length > 0
      ? `<ul class="nt-breakdown">${breakdownHtml(ai.breakdown)}</ul>`
      : ai.items.length > 0
        ? `<p class="nt-items">${ai.items.map((it) => `<span class="nt-chip">${esc(it)}</span>`).join('')}</p>`
        : `<p class="gc-note dim">${tr(M).meal.noBreakdown}</p>`;
  const why = ai.reason ? `<p class="gc-note nt-reason">${esc(ai.reason)}</p>` : '';
  return `
    <details class="nt-meal-more">
      <summary class="nt-meal-sum"><span class="nt-caret" aria-hidden="true">▸</span>${aiByline(ai)}</summary>
      ${body}
      ${why}
    </details>`;
}

/** True when a live saved meal already holds this logged meal (same name and numbers). */
function isSaved(row: MealRow, templates: readonly TemplateRow[]): boolean {
  return templates.some((t) => t.name === row.name && t.calories === row.calories && t.protein === row.protein);
}

/** "פחמ׳ 40 · שומן 12 ג׳" — only the parts the meal carries; '' when it carries neither. */
function cfText(carbs: number | undefined, fat: number | undefined): string {
  const m = tr(M).meal;
  const parts = [carbs !== undefined ? m.carbs(carbs) : '', fat !== undefined ? m.fat(fat) : ''].filter(Boolean);
  return parts.length > 0 ? m.cf(parts.join(' · ')) : '';
}

function mealRowHtml(row: MealRow, dayCalories: number, locked: boolean, saved = false): string {
  const conf = row.ai ? ` conf-${row.ai.confidence}` : '';
  const all = tr(M);
  const m = all.meal;
  const name = loggedMealName(row);
  const cf = cfText(row.carbs, row.fat);
  const mark = row.ai
    ? `<span class="nt-ai${conf}" title="${m.aiTitle(esc(row.ai.model), all.confidence[row.ai.confidence])}">🤖</span>`
    : row.source === 'catalog'
      ? `<span class="nt-ai" title="${m.catalogTitle}">📋</span>`
      : '';
  const share = dayCalories > 0 ? Math.round((row.calories / dayCalories) * 100) : 0;
  // ☆ saves the meal as the user's own — allowed on a closed day too: it
  // changes nothing in the day, only "הארוחות שלי".
  const star = saved
    ? `<span class="nt-star saved" title="${m.savedTitle}" aria-label="${m.savedTitle}">★</span>`
    : `<button class="nt-star" type="button" data-save-tpl="${esc(row.id)}" aria-label="${m.saveAria(esc(name))}">☆</button>`;
  return `
  <li class="nt-meal">
    <div class="nt-meal-row">
      <div class="nt-meal-main">
        <span class="nt-meal-name">${esc(name)}${mark}</span>
        ${row.time ? `<span class="nt-meal-time dim">🕒 ${esc(row.time)}</span>` : ''}
      </div>
      <div class="nt-meal-nums">
        <span class="nt-meal-kc">
          <span class="nt-num nt-kcal">🔥 ${row.calories}</span>
          <span class="nt-num nt-prot">${m.protein(row.protein)}</span>
          ${cf ? `<span class="nt-num nt-cf">${cf}</span>` : ''}
        </span>
        ${star}
        ${locked ? '' : `<button class="nt-del" type="button" data-del="${esc(row.id)}" aria-label="${m.deleteAria(esc(name))}">🗑</button>`}
      </div>
    </div>
    <div class="nt-share" title="${m.shareTitle(share)}" aria-hidden="true"><i style="width:${share}%"></i></div>
    ${mealDetailsHtml(row)}
  </li>`;
}

/** "08:00" → "8:00" — the window as a heading reads it. */
function hourOf(hhmm: string): string {
  return hhmm.startsWith('0') ? hhmm.slice(1) : hhmm;
}

/**
 * One meal of the day as a card: the meal as an eyebrow (name, window, its
 * subtotal and a ＋), then its items. A meal with nothing in it yet is a
 * dashed card that IS the ＋ — the day reads as a menu of what is eaten and
 * what is still to come.
 */
function slotSectionHtml(
  key: string,
  label: string,
  window: string,
  rows: readonly MealRow[],
  dayCalories: number,
  locked: boolean,
  templates: readonly TemplateRow[] = [],
): string {
  const cal = rows.reduce((s, r) => s + r.calories, 0);
  const prot = rows.reduce((s, r) => s + r.protein, 0);
  const m = tr(M).meal;
  const canAdd = !locked && key !== 'none';
  const name = `<span class="nt-slot-name">${esc(label)}${window ? ` <span class="nt-slot-win">${window}</span>` : ''}</span>`;
  if (rows.length === 0) {
    return `
  <div class="nt-slot empty" data-slot-sec="${key}">
    ${
      canAdd
        ? `<button class="nt-slot-add nt-slot-addcard" type="button" data-slot-add="${key}" aria-label="${m.slotAddAria(esc(label))}"><span class="nt-plus" aria-hidden="true">＋</span>${name}</button>`
        : `<div class="nt-slot-head">${name}</div>`
    }
  </div>`;
  }
  const add = canAdd
    ? `<button class="nt-slot-add" type="button" data-slot-add="${key}" aria-label="${m.slotAddAria(esc(label))}">＋</button>`
    : '';
  return `
  <div class="nt-slot ${rows.length === 1 ? 'single' : ''}" data-slot-sec="${key}">
    <div class="nt-slot-head">
      ${name}
      <span class="nt-slot-sum">${m.slotSum(cal, prot)}</span>
      ${add}
    </div>
    <ul class="nt-meals">${rows.map((r) => mealRowHtml(r, dayCalories, locked, isSaved(r, templates))).join('')}</ul>
  </div>`;
}

/**
 * The day's meals, split into the meals of the day (`MEAL_SLOTS`) — each with
 * its subtotal and a ＋ that opens the form on it. Meals logged before the
 * split have no slot and gather under "ללא שיוך". A closed day lists only the
 * meals that have items.
 */
function mealsCard(n: NutritionState, date: string): string {
  const rows = mealsForDate(n, date);
  const total = rows.reduce((s, r) => s + r.calories, 0);
  const locked = isDayClosed(n, date);
  const m = tr(M).meal;
  const templates = liveTemplates(n);
  const sections = MEAL_SLOTS.map((def) => {
    const mine = rows.filter((r) => r.slot === def.key);
    if (locked && mine.length === 0) return '';
    const window = def.from && def.to ? `<bdi dir="ltr">${hourOf(def.from)}–${hourOf(def.to)}</bdi>` : '';
    return slotSectionHtml(def.key, slotLabel(def.key), window, mine, total, locked, templates);
  }).join('');
  const loose = rows.filter((r) => !r.slot);
  const legacy = loose.length > 0 ? slotSectionHtml('none', m.unassigned, '', loose, total, locked, templates) : '';
  const empty = rows.length === 0 ? `<p class="empty">${m.empty}</p>` : '';
  const hasAi = rows.some((r) => r.ai);
  const hasCat = rows.some((r) => r.source === 'catalog');
  const legend = [hasAi ? m.legendAi : '', hasCat ? m.legendCatalog : ''].filter(Boolean).join(' · ');
  return `
  <section class="nt-day-meals">
    <div class="gc-title nt-meals-title">${m.title}${legend ? ` <span class="gc-sub">${legend}</span>` : ''}</div>
    ${empty}
    ${sections}
    ${legacy}
  </section>`;
}

/* ------------------------------------------------------------ the add form */

export type AddMode = 'catalog' | 'text';
/** The Hebrew labels (kept for importers); the form reads the current locale's. */
export const ADD_MODES: readonly { key: AddMode; label: string }[] = [
  { key: 'catalog', label: M.he.modes.catalog },
  { key: 'text', label: M.he.modes.text },
] as const;

function slotChipsHtml(slot: MealSlot | null): string {
  return `<div class="nt-slot-pick" role="group" aria-label="${tr(M).form.slotAria}">${MEAL_SLOTS.map(
    (s) =>
      `<button class="nt-slot-chip ${s.key === slot ? 'active' : ''}" type="button" data-slot="${s.key}"
        aria-pressed="${s.key === slot ? 'true' : 'false'}">${esc(slotShort(s.key))}</button>`,
  ).join('')}</div>`;
}

function optionsHtml(entries: readonly CatalogEntry[], picked: string): string {
  return entries
    .map((e) => `<option value="${esc(e.id)}" ${e.id === picked ? 'selected' : ''}>${esc(entryName(e))}</option>`)
    .join('');
}

/** The pick's price, or why there is none — shown live under the quantity. */
export function catalogPreviewHtml(id: string, unit: string, qtyRaw: string): string {
  const qty = parseQty(qtyRaw);
  const m = tr(M).form;
  if (qty === null) return `<p class="gc-note nt-cat-bad">${m.badQty}</p>`;
  // Rendered live from the catalog, so the lines speak the reader's language
  // (a logged pick stores the catalog's own names — see core/catalog.ts).
  const price = priceCatalog(id, unit, qty, displayNames);
  if (!price) return '';
  const lines = price.lines.length > 1 ? `<ul class="nt-breakdown">${breakdownHtml(price.lines)}</ul>` : '';
  return `<p class="nt-cat-total">${m.preview(`<b>${price.calories}</b>`, `<b>${price.protein}</b>`)}</p>
    <p class="nt-cat-macros dim">${m.previewMacros(price.carbs, price.fat)}</p>${lines}`;
}

/** The catalog pick: what, how much, when — priced live, in code. */
function catalogFormHtml(slot: MealSlot | null): string {
  // No meal chosen yet (a past day): the whole catalog, nothing presumed.
  const { fits, rest } = slot ? entriesForSlot(slot, catAll, myMeals) : { fits: [...myMeals, ...FOODS], rest: [] };
  // Everyone's ready meals: their own group, the ones that fit first.
  const ready = readyForSlot(slot, catAll);
  const listed = [...fits, ...rest, ...ready.fits, ...ready.rest];
  if (!listed.some((e) => e.id === catPick)) catPick = '';
  const entry = catPick ? catalogEntry(catPick) : null;
  const units = entry ? unitsOf(entry) : [];
  if (!units.some((u) => u.id === catUnit)) catUnit = units[0]?.id ?? '';
  const m = tr(M).form;
  const group = (label: string, list: readonly CatalogEntry[]): string =>
    list.length > 0 ? `<optgroup label="${esc(label)}">${optionsHtml(list, catPick)}</optgroup>` : '';
  const select = `
    <label class="nt-field">${m.whatAte}
      <select class="inp" id="ntCatItem">
        <option value="">${m.choose}</option>
        ${group(m.groupMeals, fits.filter((e) => e.kind === 'meal'))}
        ${group(m.groupReady, ready.fits)}
        ${group(m.groupFoods, fits.filter((e) => e.kind === 'food'))}
        ${group(m.groupRest, [...ready.rest, ...rest])}
      </select>
    </label>
    ${slot ? `<label class="nt-check"><input type="checkbox" id="ntCatAll" ${catAll ? 'checked' : ''}>${m.showAll}</label>` : ''}`;
  if (!entry) {
    return `${select}
    <p class="gc-note dim">${m.notListed}</p>`;
  }
  const unitField =
    units.length > 1
      ? `<select class="inp" id="ntCatUnit">${units
          .map((u) => `<option value="${esc(u.id)}" ${u.id === catUnit ? 'selected' : ''}>${esc(unitLabel(entry, u))}</option>`)
          .join('')}</select>`
      : `<span class="inp nt-unit-fixed">${esc(units[0] ? unitLabel(entry, units[0]) : '')}</span>`;
  return `${select}
    <div class="nt-field-row">
      <label class="nt-field">${m.qty}
        <input class="inp" id="ntCatQty" type="text" inputmode="decimal" autocomplete="off" value="${esc(catQty)}">
      </label>
      <label class="nt-field">${m.unit} ${unitField}</label>
      <label class="nt-field">${m.time}
        <input class="inp" id="ntTime" type="time" value="${esc(draft.time)}">
      </label>
    </div>
    <div class="nt-cat-preview" id="ntCatPreview" role="status">${catalogPreviewHtml(catPick, catUnit, catQty)}</div>
    <button class="action-btn" id="ntCatAdd" type="button">${m.add}</button>`;
}

/** Free text (and ✨ / 📷 when signed in) — for anything not in the catalog. */
function textFormHtml(showAi: boolean): string {
  const m = tr(M).form;
  const aiRow = showAi
    ? `
    <div class="nt-est-row">
      <button class="action-btn" id="ntEst" type="button">${m.estimate}</button>
      <button class="action-btn ghost" id="ntPhotoBtn" type="button" aria-label="${m.photoAria}">📷</button>
      <input type="file" id="ntPhoto" accept="image/*" hidden>
    </div>
    <p class="gc-note" id="ntPhotoNote" hidden>${m.photoAttached} <button class="nt-photo-clear" id="ntPhotoClear" type="button">${m.photoRemove}</button></p>
    <p class="gc-note" id="ntEstMsg" role="status"></p>
    <ul class="nt-breakdown" id="ntEstBreakdown" hidden></ul>`
    : '';
  return `
    <label class="nt-field">${m.describe}
      <textarea class="inp nt-textarea" id="ntName" rows="3" maxlength="300" autocomplete="off"
        placeholder="${esc(m.describePlaceholder)}">${esc(draft.name)}</textarea>
    </label>
    ${aiRow}
    <div class="nt-field-row">
      <label class="nt-field">${m.calories}
        <input class="inp" id="ntCal" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(draft.cal)}">
      </label>
      <label class="nt-field">${m.protein}
        <input class="inp" id="ntProt" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(draft.prot)}">
      </label>
      <label class="nt-field">${m.time}
        <input class="inp" id="ntTime" type="time" value="${esc(draft.time)}">
      </label>
    </div>
    <div class="nt-field-row nt-macro-fields">
      <label class="nt-field">${m.carbs}
        <input class="inp" id="ntCarbs" type="text" inputmode="numeric" autocomplete="off" placeholder="—" value="${esc(draft.carbs)}">
      </label>
      <label class="nt-field">${m.fat}
        <input class="inp" id="ntFat" type="text" inputmode="numeric" autocomplete="off" placeholder="—" value="${esc(draft.fat)}">
      </label>
    </div>
    <label class="nt-check"><input type="checkbox" id="ntSaveMine" ${saveMine ? 'checked' : ''}>${m.saveMine}</label>
    <button class="action-btn" id="ntAdd" type="button">${m.add}</button>`;
}

/* --------------------------------------------------------- my saved meals */

/** One row of "⭐ הארוחות שלי": name, numbers, a one-tap ＋ and (for a saved meal) a 🗑. */
function mineRowHtml(kind: 'tpl' | 'fixed', id: string, name: string, cal: number, prot: number, deletable: boolean): string {
  const m = tr(M);
  return `
      <li class="nt-mine-row">
        <button class="nt-mine-log" type="button" data-mine-${kind}="${esc(id)}" aria-label="${m.mine.logAria(esc(name))}">
          <span class="nt-plus" aria-hidden="true">＋</span>
          <span class="nt-mine-name">${esc(name)}</span>
          <span class="nt-mine-nums">${m.meal.slotSum(cal, prot)}</span>
        </button>
        ${deletable ? `<button class="nt-del" type="button" data-tpl-del="${esc(id)}" aria-label="${m.mine.deleteAria(esc(name))}">🗑</button>` : ''}
      </li>`;
}

/** What a saved meal would log now: a saved pick re-priced from the catalog, else its own numbers. */
function templateNums(t: TemplateRow): { calories: number; protein: number } {
  const p = t.pick ? priceCatalog(t.pick.id, t.pick.unit, t.pick.qty) : null;
  return p ?? { calories: t.calories, protein: t.protein };
}

/**
 * "⭐ הארוחות שלי" — the user's saved meals and the owners' fixed meals they
 * have eaten, each logged into the chosen meal with ONE tap. Empty, it says
 * how to fill it.
 */
function mineHtml(templates: readonly TemplateRow[]): string {
  const m = tr(M).mine;
  const fixed = myMeals.map((meal) => {
    const p = priceCatalog(meal.id, PORTION.id, 1);
    return mineRowHtml('fixed', meal.id, mealName(meal), p?.calories ?? 0, p?.protein ?? 0, false);
  });
  const saved = templates.map((t) => {
    const nums = templateNums(t);
    return mineRowHtml('tpl', t.id, storedPickName(t.name, t.pick), nums.calories, nums.protein, true);
  });
  const rows = [...saved, ...fixed];
  return `
    <div class="nt-mine" id="ntMine">
      <div class="nt-mine-title">${m.title}</div>
      ${rows.length > 0 ? `<ul class="nt-mine-list">${rows.join('')}</ul>` : `<p class="gc-note dim">${m.empty}</p>`}
    </div>`;
}

function addCard(
  showAi: boolean,
  date: string,
  today: string,
  slot: MealSlot | null,
  templates: readonly TemplateRow[] = [],
): string {
  // On a past day the card says WHERE the meal will land — a forgotten dinner
  // is logged onto yesterday, not silently onto today.
  const m = tr(M);
  const dayNote = date === today ? '' : ` <span class="gc-sub">${m.form.forDay(esc(fmtDate(date)))}</span>`;
  return `
  <section class="game-card nt-add" id="ntAddCard">
    <div class="gc-title">${m.form.title}${dayNote}</div>
    ${slotChipsHtml(slot)}
    ${slot ? '' : `<p class="gc-note nt-slot-need">${m.form.needSlot}</p>`}
    ${mineHtml(templates)}
    ${seg(ADD_MODES.map((it) => ({ key: it.key, label: m.modes[it.key] })), addMode, 'mode', m.form.modeAria)}
    ${addMode === 'catalog' ? catalogFormHtml(slot) : textFormHtml(showAi)}
    <p class="gc-note" id="ntAddMsg" role="status"></p>
  </section>`;
}

/**
 * A closed day in place of the add form: the day is complete, so nothing is
 * added or deleted until it is reopened — then it can be closed again.
 */
function closedCard(date: string, today: string): string {
  const m = tr(M).closedCard;
  return `
  <section class="game-card nt-closed">
    <div class="gc-title">${m.title(date === today)}</div>
    <p class="gc-note">${m.note}</p>
    <button class="action-btn" id="ntReopen" type="button">${m.reopen}</button>
  </section>`;
}

/* -------------------------------------------------------------- the chart */

/** How many days the intake chart shows, and which number. */
export type IntakeRange = 7 | 14 | 30;
export type IntakeMetric = 'calories' | 'protein';
/* The Hebrew labels below are kept for importers; the card reads the current locale's (`chartSegs`). */
export const INTAKE_RANGES: readonly { key: IntakeRange; label: string }[] = [
  { key: 7, label: M.he.chart.ranges[7] },
  { key: 14, label: M.he.chart.ranges[14] },
  { key: 30, label: M.he.chart.ranges[30] },
] as const;
export const INTAKE_METRICS: readonly { key: IntakeMetric; label: string }[] = [
  { key: 'calories', label: M.he.chart.metrics.calories },
  { key: 'protein', label: M.he.chart.metrics.protein },
] as const;
/** Every logged day, or only the days the user closed as complete. */
export type IntakeDays = 'all' | 'closed';
export const INTAKE_DAYS: readonly { key: IntakeDays; label: string }[] = [
  { key: 'all', label: M.he.chart.days.all },
  { key: 'closed', label: M.he.chart.days.closed },
] as const;
export const INTAKE_MARGINS: readonly { key: SafetyMargin; label: string }[] = [
  { key: 0, label: M.he.chart.asLogged },
  ...SAFETY_MARGINS.map((m) => ({ key: m, label: `<bdi dir="ltr">+${m}%</bdi>` })),
];

const CHART_W = 320;
const CHART_H = 150;
const PAD_X = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 18;
/** The gutter for the y labels, where a line starts: the right in Hebrew, the left in English. */
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
 * set and fits. A day not (yet) closed is drawn hollow and pale — its number
 * may still grow; with `closedOnly` it is hidden altogether (a tick, like an
 * untracked day). Today's bar carries its value.
 */
export function intakeChartSvg(
  days: readonly DaySummary[],
  metric: IntakeMetric,
  average: number | null,
  target: number | null,
  today: string,
  closedOnly = false,
): string {
  const n = days.length;
  if (n === 0) return '';
  const val = (d: DaySummary): number => (metric === 'calories' ? d.calories : d.protein);
  const dataMax = days.reduce((m, d) => Math.max(m, val(d)), 0);
  const top = niceCeiling(Math.max(dataMax, average ?? 0, target ?? 0));
  const rtl = isRtl();
  const m = tr(M).chart;
  const plotLeft = rtl ? PAD_X : LABEL_W + PAD_X;
  const plotRight = rtl ? CHART_W - LABEL_W - PAD_X : CHART_W - PAD_X;
  const plotW = plotRight - plotLeft;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotH;
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(22, Math.round(slot * 0.62 * 10) / 10));
  const gap = (slot - barW) / 2;
  const r = Math.min(4, barW / 2);
  // i = 0 (the oldest day) sits at the reading start: the right in Hebrew, the left in English.
  const cx = (i: number): number =>
    rtl
      ? Math.round((plotRight - i * slot - slot / 2) * 10) / 10
      : Math.round((plotLeft + i * slot + slot / 2) * 10) / 10;
  const y = (v: number): number => Math.round((PAD_TOP + (1 - v / top) * plotH) * 10) / 10;
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  const unit = metric === 'calories' ? m.unitCal : m.unitProtLong;
  const ylabX = rtl ? plotRight + LABEL_W / 2 + PAD_X / 2 : plotLeft - LABEL_W / 2 - PAD_X / 2;

  const grid = [top, top / 2]
    .map(
      (v) =>
        `<line class="nt-grid" x1="${plotLeft}" y1="${y(v)}" x2="${plotRight}" y2="${y(v)}"/>` +
        `<text class="nt-ylab" x="${ylabX}" y="${y(v) + 3}" text-anchor="middle">${Math.round(v)}</text>`,
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
      if (d.meals === 0 || (closedOnly && !d.closed)) {
        const why = d.meals === 0 ? m.notTracked : m.notClosed;
        return (
          `<rect class="nt-tick${d.meals === 0 ? '' : ' open'}" x="${left}" y="${baseline - 1.5}" width="${barW}" height="3" rx="1.5"/>` +
          `<rect class="nt-hit" x="${round1(left - gap)}" y="${PAD_TOP}" width="${round1(slot)}" height="${plotH + PAD_BOTTOM}">` +
          `<title>${esc(fmtDate(d.date))} · ${why}</title></rect>${xlab}`
        );
      }
      const h = Math.max(2, round1(baseline - y(v)));
      const topY = round1(baseline - h);
      // A rounded top, a flat foot anchored on the baseline.
      const path =
        `M${left},${baseline} V${round1(topY + r)} Q${left},${topY} ${round1(left + r)},${topY} ` +
        `H${round1(left + barW - r)} Q${round1(left + barW)},${topY} ${round1(left + barW)},${round1(topY + r)} V${baseline} Z`;
      const cls = `nt-bar-day${d.date === today ? ' today' : ''}${d.closed ? '' : ' open'}`;
      const direct = d.date === today ? `<text class="nt-vlab" x="${cx(i)}" y="${round1(topY - 4)}" text-anchor="middle">${v}</text>` : '';
      return (
        `<path class="${cls}" d="${path}"/>${direct}` +
        `<rect class="nt-hit" x="${round1(left - gap)}" y="${PAD_TOP}" width="${round1(slot)}" height="${plotH + PAD_BOTTOM}">` +
        `<title>${esc(m.barTitle(fmtDate(d.date), v, unit, d.meals, d.closed))}</title></rect>${xlab}`
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
    aria-label="${esc(m.aria(unit, n, average))}">
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
  const closedOnly = chartDays === 'closed';
  // The margin is a CALORIE lens: oil and sauces hide calories, not protein.
  const margin: SafetyMargin = chartMetric === 'calories' ? chartMargin : 0;
  const days = recentDays(n, today, chartRange).map((d) =>
    margin > 0 ? { ...d, calories: withMargin(d.calories, margin) } : d,
  );
  const stats = intakeStats(days, closedOnly);
  const average = chartMetric === 'calories' ? stats.avgCalories : stats.avgProtein;
  const target = chartMetric === 'calories' ? n.targets.calories : n.targets.protein;
  const m = tr(M).chart;
  const unit = chartMetric === 'calories' ? m.unitCal : m.unitProt;
  const lens = margin > 0 ? ` <bdi dir="ltr">+${margin}%</bdi>` : '';
  const anyOpen = !closedOnly && days.some((d) => d.meals > 0 && !d.closed);
  const gap =
    average !== null && target !== null && target > 0
      ? average > target
        ? ` <span class="nt-gap over">${m.over(average - target)}</span>`
        : ` <span class="nt-gap">${m.under(target - average)}</span>`
      : '';
  const legend =
    stats.tracked === 0
      ? closedOnly
        ? `<p class="empty nt-chart-empty">${m.emptyClosed}</p>`
        : `<p class="empty nt-chart-empty">${m.empty}</p>`
      : `<div class="chart-legend">
      <span class="cl-item"><i class="dot"></i>${m.daily}${lens}</span>
      ${anyOpen ? `<span class="cl-item"><i class="dot open"></i>${m.openDay}</span>` : ''}
      <span class="cl-item"><i class="dot trend"></i>${m.avg}${lens} <b>${average ?? 0} ${unit}</b>${gap} <span class="dim">(${stats.tracked} ${closedOnly ? m.trackedClosed : m.tracked})</span></span>
      ${target !== null ? `<span class="cl-item"><i class="dot goal"></i>${m.goal} <b>${target} ${unit}</b></span>` : ''}
    </div>`;
  const named = <K extends string | number>(
    items: readonly { key: K; label: string }[],
    labels: Readonly<Record<K, string>>,
  ): { key: K; label: string }[] => items.map((it) => ({ key: it.key, label: labels[it.key] }));
  const margins = INTAKE_MARGINS.map((it) => (it.key === 0 ? { key: it.key, label: m.asLogged } : it));
  return `
  <section class="game-card nt-chart-card">
    <div class="gc-title">${m.title} <span class="gc-sub">${m.sub(chartRange)}</span></div>
    ${seg(named(INTAKE_METRICS, m.metrics), chartMetric, 'metric', m.metricAria)}
    ${seg(named(INTAKE_RANGES, m.ranges), chartRange, 'range', m.rangeAria)}
    ${seg(named(INTAKE_DAYS, m.days), chartDays, 'days', m.daysAria)}
    ${chartMetric === 'calories' ? seg(margins, chartMargin, 'margin', m.marginAria) : ''}
    ${intakeChartSvg(days, chartMetric, average, target, today, closedOnly)}
    ${legend}
    <p class="gc-note dim">${m.note}${closedOnly ? m.noteClosed : m.noteOpen}</p>
  </section>`;
}

/* ------------------------------------------------------------ the targets */

function targetsCard(targets: NutritionTargets): string {
  const m = tr(M).targets;
  // An empty carbs / fat field shows what the default split would make of it.
  const split = macroTargets({ calories: targets.calories, protein: targets.protein });
  const auto = (n: number | null): string => (n === null ? '—' : m.auto(n));
  return `
  <section class="game-card nt-targets">
    <div class="gc-title">${m.title} <span class="gc-sub">${m.optional}</span></div>
    <div class="nt-field-row">
      <label class="nt-field">${m.cal}
        <input class="inp" id="ntTgtCal" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.calories ?? ''}" placeholder="—">
      </label>
      <label class="nt-field">${m.prot}
        <input class="inp" id="ntTgtProt" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.protein ?? ''}" placeholder="—">
      </label>
    </div>
    <div class="nt-field-row">
      <label class="nt-field">${m.carbs}
        <input class="inp" id="ntTgtCarbs" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.carbs ?? ''}" placeholder="${esc(auto(split.carbs))}">
      </label>
      <label class="nt-field">${m.fat}
        <input class="inp" id="ntTgtFat" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.fat ?? ''}" placeholder="${esc(auto(split.fat))}">
      </label>
    </div>
    <p class="gc-note dim">${m.splitNote}</p>
    <button class="action-btn" id="ntTgtSave" type="button">${m.save}</button>
    <p class="gc-note" id="ntTgtMsg" role="status"></p>
  </section>`;
}

/* ---------------------------------------------------------- the reminders */

/** One Hebrew line per state of the 🔔 subscription on this device (kept for importers). */
export const PUSH_STATE_HE: Readonly<Record<PushResult, string>> = M.he.pushState;

/**
 * The 🔔 card: what the reminders do, and one button that turns them on or
 * off on THIS device. The state is asked of the port after render (it is
 * async), so the card first says "בודק…".
 */
function remindersCard(): string {
  const starts = MEAL_SLOTS.filter((s) => s.from !== null)
    .map((s) => `<bdi dir="ltr">${hourOf(s.from ?? '')}</bdi>`)
    .join(', ');
  const m = tr(M).remind;
  return `
  <section class="game-card nt-remind">
    <div class="gc-title">${m.title}</div>
    <p class="gc-note">${m.note(starts)}</p>
    <p class="gc-note nt-remind-state" id="ntRemindState" role="status">${m.checking}</p>
    <button class="action-btn" id="ntRemindBtn" type="button" hidden></button>
  </section>`;
}

/* ------------------------------------------------------- the sample menu */

/**
 * "🍱 תפריט לדוגמה": the sample day closest to the calorie target (or the one
 * picked), one row per meal of the day — its ready meal, its numbers, and a
 * ＋ that logs it into that meal on the day on screen (a normal catalog pick).
 * A meal of the menu already logged in its slot shows ✓ instead. On a closed
 * day the rows are read-only.
 */
/** The menu on screen: the one picked by hand, else the one closest to the calorie target. */
function currentMenu(n: NutritionState): DailyMenu | null {
  return (menuPick ? menuById(menuPick) : null) ?? menuFor(n.targets.calories);
}

function menuCard(n: NutritionState, date: string): string {
  const menu = currentMenu(n);
  if (!menu) return '';
  const all = tr(M);
  const m = all.menu;
  const locked = isDayClosed(n, date);
  const rows = mealsForDate(n, date);
  const chips = DAILY_MENUS.map((d) => ({
    key: d.id,
    label: d.vegetarian ? `<span title="${esc(m.vegTitle)}">${m.veg(d.kcal)}</span>` : String(d.kcal),
  }));
  const items = menu.items
    .map((it, i) => {
      const meal = catalogEntry(it.meal);
      const p = priceItem(it);
      if (!meal || meal.kind !== 'meal' || !p) return '';
      const name = mealName(meal);
      const done = rows.some((r) => r.slot === it.slot && r.catalog?.id === it.meal);
      const action = locked
        ? ''
        : done
          ? `<span class="nt-menu-done" title="${esc(m.logged)}" aria-label="${esc(m.logged)}">✓</span>`
          : `<button class="nt-menu-log" type="button" data-menu-log="${i}" aria-label="${m.logAria(esc(name), esc(slotLabel(it.slot)))}">＋</button>`;
      return `
      <li class="nt-menu-row" data-menu-slot="${it.slot}">
        <span class="nt-menu-slot">${esc(slotShort(it.slot))}</span>
        <span class="nt-menu-meal">${esc(name)}<span class="nt-menu-nums">${all.meal.slotSum(p.calories, p.protein)}</span></span>
        ${action}
      </li>`;
    })
    .join('');
  const t = menuTotals(menu);
  return `
  <section class="game-card nt-menu" id="ntMenu">
    <div class="gc-title">${m.title} <span class="gc-sub">${m.sub(menu.kcal)}</span></div>
    <div class="nt-menu-pick">${seg(chips, menu.id, 'menu', m.pickAria)}</div>
    <ul class="nt-menu-list">${items}</ul>
    <p class="nt-menu-total">${m.total(t.calories, t.protein, t.carbs, t.fat)}</p>
    <p class="gc-note dim">${n.targets.calories !== null ? m.noteTarget : m.noteNoTarget}</p>
  </section>`;
}

function dayNav(date: string, today: string): string {
  const m = tr(M).nav;
  return `
  <div class="nt-daynav">
    <button class="nt-navbtn" id="ntPrev" type="button">${m.prev}</button>
    <span class="nt-date"><b>${date === today ? m.today : esc(fmtDate(date))}</b></span>
    <button class="nt-navbtn" id="ntNext" type="button" ${date === today ? 'disabled' : ''}>${m.next}</button>
  </div>`;
}

/** The whole screen as a string — pure, testable without a DOM. */
export function nutritionHtml(
  n: NutritionState,
  date: string,
  today: string,
  showAi: boolean,
  slot: MealSlot | null = null,
  withPush = false,
): string {
  return `
  ${dayNav(date, today)}
  ${totalsCard(n, date, today)}
  ${mealsCard(n, date)}
  ${isDayClosed(n, date) ? closedCard(date, today) : addCard(showAi, date, today, slot, liveTemplates(n))}
  ${menuCard(n, date)}
  ${chartCard(n, today)}
  ${targetsCard(n.targets)}
  ${withPush ? remindersCard() : ''}`;
}

/* ----------------------------------------------------------------- render */

export function renderNutrition(main: HTMLElement, deps: NutritionDeps): void {
  myMeals = myFixedMeals(deps.store.getState().nutrition);
  const today = deps.today ?? todayISO();
  if (viewDate !== null && viewDate > today) viewDate = null;
  const date = viewDate ?? today;
  const showAi = deps.ai?.configured() === true;
  // Today the form opens on the meal whose window we are in; on a past day
  // the clock says nothing about the meal, so the user picks.
  const slot = addSlot ?? (date === today ? slotAt((deps.now ?? nowHHMM)()) : null);
  main.innerHTML = nutritionHtml(deps.store.getState().nutrition, date, today, showAi, slot, deps.push !== undefined);
  wire(main, deps, date, today, slot);
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

/**
 * An OPTIONAL macro field: empty is `undefined` (unknown — never 0), a
 * number is clamped, anything else is `null` (refuse the form).
 */
function optIntOf(input: HTMLInputElement | null, max: number): number | undefined | null {
  const raw = (input?.value ?? '').trim();
  if (raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), max);
}

/**
 * The time stamped on a new meal. No time typed: on TODAY the meal is stamped
 * "now" — logging right after eating is the common case. On a past day "now"
 * would be a lie, so the time stays empty unless the user says otherwise.
 */
function stampTime(typed: string, date: string, today: string, now: () => string): string {
  if (/^\d{2}:\d{2}$/.test(typed)) return typed;
  return date === today ? now() : '';
}

function wire(main: HTMLElement, deps: NutritionDeps, date: string, today: string, slot: MealSlot | null): void {
  const again = (): void => refresh(main, deps);
  const now = deps.now ?? nowHHMM;

  /* ---- day navigation (a new day asks for its meal afresh) ---- */
  main.querySelector<HTMLButtonElement>('#ntPrev')?.addEventListener('click', () => {
    viewDate = shiftDate(date, -1);
    addSlot = null;
    again();
  });
  main.querySelector<HTMLButtonElement>('#ntNext')?.addEventListener('click', () => {
    const next = shiftDate(date, 1);
    viewDate = next >= today ? null : next;
    addSlot = null;
    again();
  });

  /* ---- the +10% / +20% fold remembers itself across re-renders ---- */
  const marginsEl = main.querySelector<HTMLDetailsElement>('#ntMargins');
  marginsEl?.addEventListener('toggle', () => {
    marginsOpen = marginsEl.open;
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

  main.querySelectorAll<HTMLButtonElement>('[data-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      chartDays = btn.dataset['days'] === 'closed' ? 'closed' : 'all';
      again();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-margin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = Number(btn.dataset['margin']);
      chartMargin = m === 10 ? 10 : m === 20 ? 20 : 0;
      again();
    });
  });

  /* ---- close / reopen the day ---- */
  main.querySelector<HTMLButtonElement>('#ntClose')?.addEventListener('click', () => {
    if (!setDayClosed(deps.store, date, true)) return;
    toast(tr(M).msg.closed);
    again();
  });
  main.querySelector<HTMLButtonElement>('#ntReopen')?.addEventListener('click', () => {
    setDayClosed(deps.store, date, false);
    toast(tr(M).msg.reopened);
    again();
  });

  /* ---- delete a meal ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['del'];
      if (!id) return;
      if (!confirm(tr(M).msg.confirmDelete)) return;
      deleteMeal(deps.store, id);
      again();
    });
  });

  /* ---- the form: which meal, which way, and what is typed ---- */
  const nameInp = main.querySelector<HTMLTextAreaElement>('#ntName');
  const calInp = main.querySelector<HTMLInputElement>('#ntCal');
  const protInp = main.querySelector<HTMLInputElement>('#ntProt');
  const carbsInp = main.querySelector<HTMLInputElement>('#ntCarbs');
  const fatInp = main.querySelector<HTMLInputElement>('#ntFat');
  const saveBox = main.querySelector<HTMLInputElement>('#ntSaveMine');
  const timeInp = main.querySelector<HTMLInputElement>('#ntTime');
  const addMsg = main.querySelector<HTMLElement>('#ntAddMsg');
  nameInp?.addEventListener('input', () => (draft.name = nameInp.value));
  calInp?.addEventListener('input', () => (draft.cal = calInp.value));
  protInp?.addEventListener('input', () => (draft.prot = protInp.value));
  carbsInp?.addEventListener('input', () => (draft.carbs = carbsInp.value));
  fatInp?.addEventListener('input', () => (draft.fat = fatInp.value));
  saveBox?.addEventListener('change', () => (saveMine = saveBox.checked));
  timeInp?.addEventListener('input', () => (draft.time = timeInp.value));
  timeInp?.addEventListener('change', () => (draft.time = timeInp.value));
  const clearDraft = (): void => {
    draft = { name: '', cal: '', prot: '', carbs: '', fat: '', time: '' };
    saveMine = false;
  };
  const stampNow = (): string => stampTime(timeInp?.value ?? '', date, today, now);
  /** Log one ready-made input into the day (saved meal, fixed meal, menu item). */
  const logReady = (input: MealInput | null, msg: string): void => {
    const ev = input ? logMeal(deps.store, input, crypto.randomUUID()) : null;
    if (!ev) {
      if (addMsg) addMsg.textContent = tr(M).msg.pickFailed;
      return;
    }
    toast(msg);
    again();
  };
  const needSlot = (): boolean => {
    if (slot) return false;
    if (addMsg) addMsg.textContent = tr(M).msg.needSlot;
    return true;
  };

  main.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset['slot'];
      addSlot = MEAL_SLOTS.find((s) => s.key === key)?.key ?? addSlot;
      again();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-slot-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset['slotAdd'];
      addSlot = MEAL_SLOTS.find((s) => s.key === key)?.key ?? addSlot;
      again();
      document.getElementById('ntAddCard')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      addMode = btn.dataset['mode'] === 'text' ? 'text' : 'catalog';
      again();
    });
  });

  /* ---- ⭐ my meals: one tap logs into the chosen meal ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-mine-tpl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (needSlot() || !slot) return;
      const tpl = liveTemplates(deps.store.getState().nutrition).find((t) => t.id === btn.dataset['mineTpl']);
      if (!tpl) return;
      logReady(templateMealInput(tpl, { date, slot, time: stampNow() }), tr(M).msg.mealLogged);
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-mine-fixed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (needSlot() || !slot) return;
      const id = btn.dataset['mineFixed'] ?? '';
      logReady(catalogMealInput({ id, unit: PORTION.id, qty: 1, date, slot, time: stampNow() }), tr(M).msg.pickLogged);
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-tpl-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['tplDel'];
      if (!id || !confirm(tr(M).mine.confirmDelete)) return;
      deleteTemplate(deps.store, id);
      toast(tr(M).msg.templateDeleted);
      again();
    });
  });

  /* ---- ☆ save a logged meal as my own ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-save-tpl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = deps.store.getState().nutrition;
      const row = mealsForDate(n, date).find((r) => r.id === btn.dataset['saveTpl']);
      if (!row) return;
      if (isSaved(row, liveTemplates(n))) {
        toast(tr(M).msg.templateExists);
        return;
      }
      if (saveTemplate(deps.store, templateFromMeal(row), crypto.randomUUID())) toast(tr(M).msg.templateSaved);
      again();
    });
  });

  /* ---- 🍱 the sample menu ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((btn) => {
    btn.addEventListener('click', () => {
      menuPick = btn.dataset['menu'] ?? null;
      again();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-menu-log]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = currentMenu(deps.store.getState().nutrition)?.items[Number(btn.dataset['menuLog'])];
      if (!item) return;
      logReady(
        catalogMealInput({ id: item.meal, unit: PORTION.id, qty: 1, date, slot: item.slot, time: stampNow() }),
        tr(M).msg.menuLogged,
      );
    });
  });

  /* ---- a catalog pick, priced in code ---- */
  const itemSel = main.querySelector<HTMLSelectElement>('#ntCatItem');
  itemSel?.addEventListener('change', () => {
    catPick = itemSel.value;
    catUnit = '';
    catQty = '1';
    again();
  });
  const allBox = main.querySelector<HTMLInputElement>('#ntCatAll');
  allBox?.addEventListener('change', () => {
    catAll = allBox.checked;
    again();
  });
  const unitSel = main.querySelector<HTMLSelectElement>('#ntCatUnit');
  unitSel?.addEventListener('change', () => {
    catUnit = unitSel.value;
    again();
  });
  const qtyInp = main.querySelector<HTMLInputElement>('#ntCatQty');
  const preview = main.querySelector<HTMLElement>('#ntCatPreview');
  // Typing re-prices in place — no re-render, the caret stays put.
  qtyInp?.addEventListener('input', () => {
    catQty = qtyInp.value;
    if (preview) preview.innerHTML = catalogPreviewHtml(catPick, catUnit, catQty);
  });
  main.querySelector<HTMLButtonElement>('#ntCatAdd')?.addEventListener('click', () => {
    if (needSlot() || !slot) return;
    const qty = parseQty(catQty);
    if (qty === null) {
      if (addMsg) addMsg.textContent = tr(M).form.badQty;
      return;
    }
    const input = catalogMealInput({
      id: catPick,
      unit: catUnit,
      qty,
      date,
      slot,
      time: stampTime(timeInp?.value ?? '', date, today, now),
    });
    const ev = input ? logMeal(deps.store, input, crypto.randomUUID()) : null;
    if (!ev) {
      if (addMsg) addMsg.textContent = tr(M).msg.pickFailed;
      return;
    }
    resetPick();
    clearDraft();
    toast(tr(M).msg.pickLogged);
    again();
  });

  /* ---- free text (and ✨) ---- */
  main.querySelector<HTMLButtonElement>('#ntAdd')?.addEventListener('click', () => {
    const name = (nameInp?.value ?? '').trim();
    const calories = intOf(calInp, MEAL_MAX_CALORIES);
    const protein = intOf(protInp, MEAL_MAX_PROTEIN);
    const carbs = optIntOf(carbsInp, MEAL_MAX_CARBS);
    const fat = optIntOf(fatInp, MEAL_MAX_FAT);
    if (needSlot() || !slot) return;
    if (!name) {
      if (addMsg) addMsg.textContent = tr(M).msg.needName;
      return;
    }
    if (calories === null || protein === null) {
      if (addMsg) addMsg.textContent = tr(M).msg.needNumbers;
      return;
    }
    if (carbs === null || fat === null) {
      if (addMsg) addMsg.textContent = tr(M).msg.badMacros;
      return;
    }
    const macros = { ...(carbs !== undefined ? { carbs } : {}), ...(fat !== undefined ? { fat } : {}) };
    // The estimate's byline survives only while its numbers do.
    const est = lastEstimate;
    const fromAi = est !== null && est.estimate.calories === calories && est.estimate.proteinG === protein;
    const input: MealInput = {
      date,
      name,
      calories,
      protein,
      ...macros,
      time: stampTime(timeInp?.value ?? '', date, today, now),
      slot,
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
      if (addMsg) addMsg.textContent = tr(M).msg.mealFailed;
      return;
    }
    // "⭐ לשמור גם בארוחות שלי": the same meal, as the user's own (its numbers).
    const tpl: TemplateInput = { name: input.name, calories, protein, ...macros };
    const keep = saveMine && !liveTemplates(deps.store.getState().nutrition).some(
      (t) => t.name === tpl.name && t.calories === calories && t.protein === protein,
    );
    if (keep) saveTemplate(deps.store, tpl, crypto.randomUUID());
    lastEstimate = null;
    photo = null;
    clearDraft();
    toast(keep ? tr(M).msg.templateSaved : tr(M).msg.mealLogged);
    again();
  });

  /* ---- 🔔 reminders ---- */
  const push = deps.push;
  const remindState = main.querySelector<HTMLElement>('#ntRemindState');
  const remindBtn = main.querySelector<HTMLButtonElement>('#ntRemindBtn');
  if (push && remindState && remindBtn) {
    let on = false;
    const show = (st: PushResult): void => {
      remindState.textContent = tr(M).pushState[st];
      on = st === 'on';
      const actionable = st === 'on' || st === 'off' || st === 'failed';
      remindBtn.hidden = !actionable;
      remindBtn.disabled = false;
      remindBtn.textContent = on ? tr(M).remind.turnOff : tr(M).remind.turnOn;
      remindBtn.classList.toggle('ghost', on);
    };
    void push.status().then(show, () => show('failed'));
    remindBtn.addEventListener('click', () => {
      remindBtn.disabled = true;
      remindState.textContent = on ? tr(M).remind.turningOff : tr(M).remind.turningOn;
      void (on ? push.disable() : push.enable()).then(show, () => show('failed'));
    });
  }

  /* ---- targets ---- */
  const tgtMsg = main.querySelector<HTMLElement>('#ntTgtMsg');
  main.querySelector<HTMLButtonElement>('#ntTgtSave')?.addEventListener('click', () => {
    const read = (sel: string): number | null | 'bad' => {
      const raw = (main.querySelector<HTMLInputElement>(sel)?.value ?? '').trim();
      if (raw === '') return null;
      const v = Number(raw);
      return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 'bad';
    };
    const cal = read('#ntTgtCal');
    const prot = read('#ntTgtProt');
    const carbs = read('#ntTgtCarbs');
    const fat = read('#ntTgtFat');
    if (cal === 'bad' || prot === 'bad' || carbs === 'bad' || fat === 'bad') {
      if (tgtMsg) tgtMsg.textContent = tr(M).msg.badTargets;
      return;
    }
    setTargets(deps.store, { calories: cal, protein: prot, carbs, fat });
    toast(tr(M).msg.targetsSaved);
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
        if (estMsg) estMsg.textContent = tr(M).msg.photoFailed;
      });
  });

  if (ai && estBtn) {
    estBtn.addEventListener('click', () => {
      const text = (nameInp?.value ?? '').trim();
      if (!text && !photo) {
        if (estMsg) estMsg.textContent = tr(M).msg.needInput;
        return;
      }
      estBtn.disabled = true;
      const label = estBtn.textContent;
      estBtn.textContent = tr(M).msg.estimating;
      if (estMsg) estMsg.textContent = '';
      if (breakdown) {
        breakdown.hidden = true;
        breakdown.innerHTML = '';
      }
      void ai
        .estimate({ text, ...(photo ? { photo } : {}), catalog: catalogHints(myMeals) })
        .then((result) => {
          if (!result.ok) {
            if (estMsg) estMsg.textContent = tr(M).estimateError[result.error];
            return;
          }
          const est = result.estimate;
          lastEstimate = { estimate: est, source: photo ? 'gemini_photo' : 'gemini_text' };
          // Prefill by poking the LIVE inputs — no re-render, nothing typed is lost.
          if (calInp) calInp.value = String(est.calories);
          if (protInp) protInp.value = String(est.proteinG);
          draft.cal = String(est.calories);
          draft.prot = String(est.proteinG);
          // Carbs / fat only when the function returned them; otherwise unknown.
          draft.carbs = est.carbsG !== undefined ? String(est.carbsG) : '';
          draft.fat = est.fatG !== undefined ? String(est.fatG) : '';
          if (carbsInp) carbsInp.value = draft.carbs;
          if (fatInp) fatInp.value = draft.fat;
          if (estMsg) {
            const names = est.items.map(itemLabel);
            const m = tr(M);
            const found = names.length > 0 ? m.msg.found(names.join(', ')) : '';
            // Anything short of high confidence says WHY, so the user knows what
            // to add to the description (a quantity, a preparation) and retry.
            const why = est.confidence !== 'high' && est.reason ? ` (${est.reason})` : '';
            estMsg.textContent = m.msg.estimated(found, m.confidence[est.confidence], why);
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
