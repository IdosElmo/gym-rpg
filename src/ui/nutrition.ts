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
 *
 * WHOLE DAYS ONLY, AND AN HONEST MARGIN. "סגרתי את היום" marks a day's log as
 * complete (`nutrition_day_closed`); a closed day is LOCKED — no add, no
 * delete — until "פתיחה להוספה" reopens it, so a closed day's number never
 * moves by accident. The chart can average over closed days only, hiding the
 * half-logged ones. And because estimates run low (oil, sauces, portions), the
 * day's calories are also drawn at +10% and +20% (`SAFETY_MARGINS`) — two more
 * rings, and a chart lens — display-only, nothing stored changes.
 */

import {
  catalogEntry,
  catalogHints,
  catalogMealInput,
  entriesForSlot,
  myFixedMeals,
  parseQty,
  priceCatalog,
  unitsOf,
} from '../core/catalog.ts';
import {
  MEAL_MAX_CALORIES,
  MEAL_MAX_PROTEIN,
  MEAL_SLOTS,
  SAFETY_MARGINS,
  dayTotals,
  deleteMeal,
  intakeStats,
  isDayClosed,
  logMeal,
  mealsForDate,
  recentDays,
  setDayClosed,
  setTargets,
  shiftDate,
  slotAt,
  withMargin,
  type DaySummary,
  type MealInput,
  type MealRow,
  type SafetyMargin,
} from '../core/nutrition.ts';
import { fmtDate, todayISO } from '../core/workout.ts';
import { FOODS, type CatalogEntry, type CatalogMeal } from '../data/foods.ts';
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
import { displayNames, entryName, unitLabel } from '../i18n/foodText.ts';

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
let draft = { name: '', cal: '', prot: '', time: '' };

/** Forget everything screen-local (tests, and a data wipe). */
export function resetNutritionScreen(): void {
  viewDate = null;
  photo = null;
  lastEstimate = null;
  chartRange = 7;
  chartMetric = 'calories';
  chartDays = 'all';
  chartMargin = 0;
  addSlot = null;
  addMode = 'catalog';
  resetPick();
  draft = { name: '', cal: '', prot: '', time: '' };
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

function totalsCard(n: NutritionState, date: string, today: string): string {
  const t = dayTotals(n, date);
  const closed = isDayClosed(n, date);
  const g = n.targets;
  const noTargets = g.calories === null && g.protein === null;
  const protPct = g.protein !== null && g.protein > 0 ? Math.round((t.protein / g.protein) * 100) : null;
  const m = tr(M).totals;
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
    <div class="nt-rings">
      ${ringHtml('cal', t.calories, g.calories)}
      ${ringHtml('prot', t.protein, g.protein)}
    </div>
    <div class="nt-margins">
      <p class="nt-margins-title">${m.marginsTitle}</p>
      <div class="nt-rings">
        ${SAFETY_MARGINS.map((m) => ringHtml('cal', withMargin(t.calories, m), g.calories, m)).join('')}
      </div>
    </div>
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
      <ul class="nt-breakdown">${breakdownHtml(cat.lines)}</ul>
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

function mealRowHtml(row: MealRow, dayCalories: number, locked: boolean): string {
  const conf = row.ai ? ` conf-${row.ai.confidence}` : '';
  const all = tr(M);
  const m = all.meal;
  const mark = row.ai
    ? `<span class="nt-ai${conf}" title="${m.aiTitle(esc(row.ai.model), all.confidence[row.ai.confidence])}">🤖</span>`
    : row.source === 'catalog'
      ? `<span class="nt-ai" title="${m.catalogTitle}">📋</span>`
      : '';
  const share = dayCalories > 0 ? Math.round((row.calories / dayCalories) * 100) : 0;
  return `
  <li class="nt-meal">
    <div class="nt-meal-row">
      <div class="nt-meal-main">
        <span class="nt-meal-name">${esc(row.name)}${mark}</span>
        ${row.time ? `<span class="nt-meal-time dim">🕒 ${esc(row.time)}</span>` : ''}
      </div>
      <div class="nt-meal-nums">
        <span class="nt-num">🔥 ${row.calories}</span>
        <span class="nt-num">${m.protein(row.protein)}</span>
        ${locked ? '' : `<button class="nt-del" type="button" data-del="${esc(row.id)}" aria-label="${m.deleteAria(esc(row.name))}">🗑</button>`}
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

/** One meal of the day: its heading, subtotal, ＋ and its items. */
function slotSectionHtml(
  key: string,
  label: string,
  window: string,
  rows: readonly MealRow[],
  dayCalories: number,
  locked: boolean,
): string {
  const cal = rows.reduce((s, r) => s + r.calories, 0);
  const prot = rows.reduce((s, r) => s + r.protein, 0);
  const m = tr(M).meal;
  const add =
    locked || key === 'none'
      ? ''
      : `<button class="nt-slot-add" type="button" data-slot-add="${key}" aria-label="${m.slotAddAria(esc(label))}">＋</button>`;
  return `
  <div class="nt-slot ${rows.length === 0 ? 'empty' : ''}" data-slot-sec="${key}">
    <div class="nt-slot-head">
      <span class="nt-slot-name">${esc(label)}${window ? ` <span class="nt-slot-win dim">${window}</span>` : ''}</span>
      ${rows.length > 0 ? `<span class="nt-slot-sum">${m.slotSum(cal, prot)}</span>` : ''}
      ${add}
    </div>
    ${rows.length > 0 ? `<ul class="nt-meals">${rows.map((r) => mealRowHtml(r, dayCalories, locked)).join('')}</ul>` : ''}
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
  const sections = MEAL_SLOTS.map((def) => {
    const mine = rows.filter((r) => r.slot === def.key);
    if (locked && mine.length === 0) return '';
    const window = def.from && def.to ? `<bdi dir="ltr">${hourOf(def.from)}–${hourOf(def.to)}</bdi>` : '';
    return slotSectionHtml(def.key, slotLabel(def.key), window, mine, total, locked);
  }).join('');
  const loose = rows.filter((r) => !r.slot);
  const legacy = loose.length > 0 ? slotSectionHtml('none', m.unassigned, '', loose, total, locked) : '';
  const empty = rows.length === 0 ? `<p class="empty">${m.empty}</p>` : '';
  const hasAi = rows.some((r) => r.ai);
  const hasCat = rows.some((r) => r.source === 'catalog');
  const legend = [hasAi ? m.legendAi : '', hasCat ? m.legendCatalog : ''].filter(Boolean).join(' · ');
  return `
  <section class="game-card nt-day-meals">
    <div class="gc-title">${m.title}${legend ? ` <span class="gc-sub">${legend}</span>` : ''}</div>
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
  return `<p class="nt-cat-total">${m.preview(`<b>${price.calories}</b>`, `<b>${price.protein}</b>`)}</p>${lines}`;
}

/** The catalog pick: what, how much, when — priced live, in code. */
function catalogFormHtml(slot: MealSlot | null): string {
  // No meal chosen yet (a past day): the whole catalog, nothing presumed.
  const { fits, rest } = slot ? entriesForSlot(slot, catAll, myMeals) : { fits: [...myMeals, ...FOODS], rest: [] };
  const listed = [...fits, ...rest];
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
        ${group(m.groupFoods, fits.filter((e) => e.kind === 'food'))}
        ${group(m.groupRest, rest)}
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
    <button class="action-btn" id="ntAdd" type="button">${m.add}</button>`;
}

function addCard(showAi: boolean, date: string, today: string, slot: MealSlot | null): string {
  // On a past day the card says WHERE the meal will land — a forgotten dinner
  // is logged onto yesterday, not silently onto today.
  const m = tr(M);
  const dayNote = date === today ? '' : ` <span class="gc-sub">${m.form.forDay(esc(fmtDate(date)))}</span>`;
  return `
  <section class="game-card nt-add" id="ntAddCard">
    <div class="gc-title">${m.form.title}${dayNote}</div>
    ${slotChipsHtml(slot)}
    ${slot ? '' : `<p class="gc-note nt-slot-need">${m.form.needSlot}</p>`}
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

function dayNav(date: string, today: string): string {
  const m = tr(M).nav;
  return `
  <div class="nt-daynav">
    <button class="action-btn ghost" id="ntPrev" type="button">${m.prev}</button>
    <span class="nt-date"><b>${date === today ? m.today : esc(fmtDate(date))}</b></span>
    <button class="action-btn ghost" id="ntNext" type="button" ${date === today ? 'disabled' : ''}>${m.next}</button>
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
  ${isDayClosed(n, date) ? closedCard(date, today) : addCard(showAi, date, today, slot)}
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
  const timeInp = main.querySelector<HTMLInputElement>('#ntTime');
  const addMsg = main.querySelector<HTMLElement>('#ntAddMsg');
  nameInp?.addEventListener('input', () => (draft.name = nameInp.value));
  calInp?.addEventListener('input', () => (draft.cal = calInp.value));
  protInp?.addEventListener('input', () => (draft.prot = protInp.value));
  timeInp?.addEventListener('input', () => (draft.time = timeInp.value));
  timeInp?.addEventListener('change', () => (draft.time = timeInp.value));
  const clearDraft = (): void => {
    draft = { name: '', cal: '', prot: '', time: '' };
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
    if (needSlot() || !slot) return;
    if (!name) {
      if (addMsg) addMsg.textContent = tr(M).msg.needName;
      return;
    }
    if (calories === null || protein === null) {
      if (addMsg) addMsg.textContent = tr(M).msg.needNumbers;
      return;
    }
    // The estimate's byline survives only while its numbers do.
    const est = lastEstimate;
    const fromAi = est !== null && est.estimate.calories === calories && est.estimate.proteinG === protein;
    const input: MealInput = {
      date,
      name,
      calories,
      protein,
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
    lastEstimate = null;
    photo = null;
    clearDraft();
    toast(tr(M).msg.mealLogged);
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
    const calRaw = (main.querySelector<HTMLInputElement>('#ntTgtCal')?.value ?? '').trim();
    const protRaw = (main.querySelector<HTMLInputElement>('#ntTgtProt')?.value ?? '').trim();
    const cal = calRaw === '' ? null : Number(calRaw);
    const prot = protRaw === '' ? null : Number(protRaw);
    if ((cal !== null && (!Number.isFinite(cal) || cal < 0)) || (prot !== null && (!Number.isFinite(prot) || prot < 0))) {
      if (tgtMsg) tgtMsg.textContent = tr(M).msg.badTargets;
      return;
    }
    setTargets(deps.store, {
      calories: cal === null ? null : Math.floor(cal),
      protein: prot === null ? null : Math.floor(prot),
    });
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
