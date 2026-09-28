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
import { FIXED_MEALS, FOODS, type CatalogEntry } from '../data/foods.ts';
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
  // A margin ring names its lens; the "+" stays on the left of the digits in RTL.
  const label =
    margin > 0 ? `<bdi dir="ltr">+${margin}%</bdi>` : kind === 'cal' ? 'קלוריות' : 'גרם חלבון';
  const ariaLabel = margin > 0 ? `קלוריות בתוספת ${margin}%` : kind === 'cal' ? 'קלוריות' : 'גרם חלבון';
  const emoji = kind === 'cal' ? '🔥' : '💪';
  const sub = !has
    ? `<span class="nt-ring-sub dim">ללא יעד</span>`
    : over
      ? `<span class="nt-ring-sub over">+${value - target} מעל היעד</span>`
      : `<span class="nt-ring-sub">נותרו ${target - value}</span>`;
  const pctText = has ? `${Math.round((value / target) * 100)}%` : '';
  const aria = has ? `${ariaLabel}: ${value} מתוך ${target}` : `${ariaLabel}: ${value}`;
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
  const status =
    t.meals === 0
      ? 'עוד לא תועדו ארוחות ביום הזה'
      : closed
        ? 'היום נסגר — הוא נספר בממוצע של ימים מלאים בגרף'
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
    <div class="gc-title">סיכום ${date === today ? 'היום' : 'היום הזה'} <span class="gc-sub">${t.meals === 0 ? 'אין ארוחות' : `${t.meals} ארוחות`}</span>${
      closed ? ` <span class="nt-closed-chip">✅ יום סגור</span>` : ''
    }</div>
    <div class="nt-rings">
      ${ringHtml('cal', t.calories, g.calories)}
      ${ringHtml('prot', t.protein, g.protein)}
    </div>
    <div class="nt-margins">
      <p class="nt-margins-title">ואם ההערכות נמוכות מהמציאות? 🔥 הקלוריות בתוספת</p>
      <div class="nt-rings">
        ${SAFETY_MARGINS.map((m) => ringHtml('cal', withMargin(t.calories, m), g.calories, m)).join('')}
      </div>
    </div>
    <p class="gc-note nt-status">${status}</p>
    ${
      t.meals > 0 && !closed
        ? `<button class="action-btn ghost nt-close-btn" id="ntClose" type="button">✅ סגרתי את היום</button>
    <p class="gc-note dim">סיימתם לרשום את כל מה שנאכל ביום הזה? סגירה מכניסה אותו לממוצע של ימים מלאים בגרף.</p>`
        : ''
    }
  </section>`;
}

/* ------------------------------------------------------------- the meals */

/** The estimate's byline, e.g. "🤖 הערכת Gemini · דיוק בינוני". */
function aiByline(ai: MealAiInfo): string {
  return `🤖 הערכת ${esc(ai.model === 'gemini' ? 'Gemini' : ai.model)} · דיוק ${CONFIDENCE_HE[ai.confidence]}`;
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
      <summary class="nt-meal-sum"><span class="nt-caret" aria-hidden="true">▸</span>📋 מהקטלוג · ${cat.lines.length} רכיבים</summary>
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
        : `<p class="gc-note dim">ההערכה לא כללה פירוט מרכיבים.</p>`;
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
  const mark = row.ai
    ? `<span class="nt-ai${conf}" title="הוערך על ידי ${esc(row.ai.model)} · דיוק ${CONFIDENCE_HE[row.ai.confidence]}">🤖</span>`
    : row.source === 'catalog'
      ? `<span class="nt-ai" title="מהקטלוג — חושב לפי ערכים קבועים">📋</span>`
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
        <span class="nt-num">💪 ${row.protein} ג׳</span>
        ${locked ? '' : `<button class="nt-del" type="button" data-del="${esc(row.id)}" aria-label="מחיקת ${esc(row.name)}">🗑</button>`}
      </div>
    </div>
    <div class="nt-share" title="${share}% מהקלוריות של היום" aria-hidden="true"><i style="width:${share}%"></i></div>
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
  const add =
    locked || key === 'none'
      ? ''
      : `<button class="nt-slot-add" type="button" data-slot-add="${key}" aria-label="הוספה ל${esc(label)}">＋</button>`;
  return `
  <div class="nt-slot ${rows.length === 0 ? 'empty' : ''}" data-slot-sec="${key}">
    <div class="nt-slot-head">
      <span class="nt-slot-name">${esc(label)}${window ? ` <span class="nt-slot-win dim">${window}</span>` : ''}</span>
      ${rows.length > 0 ? `<span class="nt-slot-sum">🔥 ${cal} · 💪 ${prot} ג׳</span>` : ''}
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
  const sections = MEAL_SLOTS.map((def) => {
    const mine = rows.filter((r) => r.slot === def.key);
    if (locked && mine.length === 0) return '';
    const window = def.from && def.to ? `<bdi dir="ltr">${hourOf(def.from)}–${hourOf(def.to)}</bdi>` : '';
    return slotSectionHtml(def.key, def.label, window, mine, total, locked);
  }).join('');
  const loose = rows.filter((r) => !r.slot);
  const legacy = loose.length > 0 ? slotSectionHtml('none', 'ללא שיוך', '', loose, total, locked) : '';
  const empty =
    rows.length === 0 ? `<p class="empty">לא תועדו ארוחות ביום הזה — לוחצים ＋ ליד ארוחה, או בוחרים למטה 👇</p>` : '';
  const hasAi = rows.some((r) => r.ai);
  const hasCat = rows.some((r) => r.source === 'catalog');
  const legend = [hasAi ? '🤖 = הערכת Gemini' : '', hasCat ? '📋 = מהקטלוג' : ''].filter(Boolean).join(' · ');
  return `
  <section class="game-card nt-day-meals">
    <div class="gc-title">הארוחות של היום${legend ? ` <span class="gc-sub">${legend}</span>` : ''}</div>
    ${empty}
    ${sections}
    ${legacy}
  </section>`;
}

/* ------------------------------------------------------------ the add form */

export type AddMode = 'catalog' | 'text';
export const ADD_MODES: readonly { key: AddMode; label: string }[] = [
  { key: 'catalog', label: '📋 מהקטלוג' },
  { key: 'text', label: '✍️ תיאור / תמונה' },
] as const;

function slotChipsHtml(slot: MealSlot | null): string {
  return `<div class="nt-slot-pick" role="group" aria-label="לאיזו ארוחה">${MEAL_SLOTS.map(
    (s) =>
      `<button class="nt-slot-chip ${s.key === slot ? 'active' : ''}" type="button" data-slot="${s.key}"
        aria-pressed="${s.key === slot ? 'true' : 'false'}">${esc(s.short)}</button>`,
  ).join('')}</div>`;
}

function optionsHtml(entries: readonly CatalogEntry[], picked: string): string {
  return entries
    .map((e) => `<option value="${esc(e.id)}" ${e.id === picked ? 'selected' : ''}>${esc(e.name)}</option>`)
    .join('');
}

/** The pick's price, or why there is none — shown live under the quantity. */
export function catalogPreviewHtml(id: string, unit: string, qtyRaw: string): string {
  const qty = parseQty(qtyRaw);
  if (qty === null) return `<p class="gc-note nt-cat-bad">כמות לא תקינה — למשל 1, 0.5 או 1/2.</p>`;
  const price = priceCatalog(id, unit, qty);
  if (!price) return '';
  const lines = price.lines.length > 1 ? `<ul class="nt-breakdown">${breakdownHtml(price.lines)}</ul>` : '';
  return `<p class="nt-cat-total">🔥 <b>${price.calories}</b> קלוריות · 💪 <b>${price.protein}</b> ג׳ חלבון</p>${lines}`;
}

/** The catalog pick: what, how much, when — priced live, in code. */
function catalogFormHtml(slot: MealSlot | null): string {
  // No meal chosen yet (a past day): the whole catalog, nothing presumed.
  const { fits, rest } = slot ? entriesForSlot(slot, catAll) : { fits: [...FIXED_MEALS, ...FOODS], rest: [] };
  const listed = [...fits, ...rest];
  if (!listed.some((e) => e.id === catPick)) catPick = '';
  const entry = catPick ? catalogEntry(catPick) : null;
  const units = entry ? unitsOf(entry) : [];
  if (!units.some((u) => u.id === catUnit)) catUnit = units[0]?.id ?? '';
  const group = (label: string, list: readonly CatalogEntry[]): string =>
    list.length > 0 ? `<optgroup label="${esc(label)}">${optionsHtml(list, catPick)}</optgroup>` : '';
  const select = `
    <label class="nt-field">מה אכלתם
      <select class="inp" id="ntCatItem">
        <option value="">— בחרו מהרשימה —</option>
        ${group('ארוחות קבועות', fits.filter((e) => e.kind === 'meal'))}
        ${group('מאכלים', fits.filter((e) => e.kind === 'food'))}
        ${group('שאר הקטלוג', rest)}
      </select>
    </label>
    ${slot ? `<label class="nt-check"><input type="checkbox" id="ntCatAll" ${catAll ? 'checked' : ''}> הצגת כל הקטלוג, לא רק מה שמתאים לארוחה הזו</label>` : ''}`;
  if (!entry) {
    return `${select}
    <p class="gc-note dim">לא מוצאים ברשימה? עוברים ל״תיאור / תמונה״ — ההערכה מכירה את הקטלוג.</p>`;
  }
  const unitField =
    units.length > 1
      ? `<select class="inp" id="ntCatUnit">${units
          .map((u) => `<option value="${esc(u.id)}" ${u.id === catUnit ? 'selected' : ''}>${esc(u.label)}</option>`)
          .join('')}</select>`
      : `<span class="inp nt-unit-fixed">${esc(units[0]?.label ?? '')}</span>`;
  return `${select}
    <div class="nt-field-row">
      <label class="nt-field">כמות
        <input class="inp" id="ntCatQty" type="text" inputmode="decimal" autocomplete="off" value="${esc(catQty)}">
      </label>
      <label class="nt-field">יחידה ${unitField}</label>
      <label class="nt-field">שעה
        <input class="inp" id="ntTime" type="time" value="${esc(draft.time)}">
      </label>
    </div>
    <div class="nt-cat-preview" id="ntCatPreview" role="status">${catalogPreviewHtml(catPick, catUnit, catQty)}</div>
    <button class="action-btn" id="ntCatAdd" type="button">הוספה</button>`;
}

/** Free text (and ✨ / 📷 when signed in) — for anything not in the catalog. */
function textFormHtml(showAi: boolean): string {
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
  return `
    <label class="nt-field">תיאור הארוחה
      <textarea class="inp nt-textarea" id="ntName" rows="3" maxlength="300" autocomplete="off"
        placeholder="למשל: טוסט עם 2 פרוסות גבינה צהובה וקופסת טונה אחת — ככל שהתיאור מפורט יותר (כמויות, אופן הכנה), ההערכה מדויקת יותר">${esc(draft.name)}</textarea>
    </label>
    ${aiRow}
    <div class="nt-field-row">
      <label class="nt-field">קלוריות
        <input class="inp" id="ntCal" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(draft.cal)}">
      </label>
      <label class="nt-field">חלבון (גרם)
        <input class="inp" id="ntProt" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(draft.prot)}">
      </label>
      <label class="nt-field">שעה
        <input class="inp" id="ntTime" type="time" value="${esc(draft.time)}">
      </label>
    </div>
    <button class="action-btn" id="ntAdd" type="button">הוספה</button>`;
}

function addCard(showAi: boolean, date: string, today: string, slot: MealSlot | null): string {
  // On a past day the card says WHERE the meal will land — a forgotten dinner
  // is logged onto yesterday, not silently onto today.
  const dayNote = date === today ? '' : ` <span class="gc-sub">ליום ${esc(fmtDate(date))}</span>`;
  return `
  <section class="game-card nt-add" id="ntAddCard">
    <div class="gc-title">הוספה${dayNote}</div>
    ${slotChipsHtml(slot)}
    ${slot ? '' : `<p class="gc-note nt-slot-need">לאיזו ארוחה להוסיף? בוחרים למעלה.</p>`}
    ${seg(ADD_MODES, addMode, 'mode', 'איך לרשום')}
    ${addMode === 'catalog' ? catalogFormHtml(slot) : textFormHtml(showAi)}
    <p class="gc-note" id="ntAddMsg" role="status"></p>
  </section>`;
}

/**
 * A closed day in place of the add form: the day is complete, so nothing is
 * added or deleted until it is reopened — then it can be closed again.
 */
function closedCard(date: string, today: string): string {
  return `
  <section class="game-card nt-closed">
    <div class="gc-title">✅ ${date === today ? 'היום' : 'היום הזה'} סגור</div>
    <p class="gc-note">סימנתם שהרישום של היום הזה מלא, אז הוספה ומחיקה של ארוחות נעולות. צריך לשנות משהו? פותחים את היום, מעדכנים וסוגרים שוב.</p>
    <button class="action-btn" id="ntReopen" type="button">🔓 פתיחה להוספה</button>
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
/** Every logged day, or only the days the user closed as complete. */
export type IntakeDays = 'all' | 'closed';
export const INTAKE_DAYS: readonly { key: IntakeDays; label: string }[] = [
  { key: 'all', label: 'כל הימים' },
  { key: 'closed', label: '✅ רק ימים סגורים' },
] as const;
export const INTAKE_MARGINS: readonly { key: SafetyMargin; label: string }[] = [
  { key: 0, label: 'כפי שנרשם' },
  ...SAFETY_MARGINS.map((m) => ({ key: m, label: `<bdi dir="ltr">+${m}%</bdi>` })),
];

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
      if (d.meals === 0 || (closedOnly && !d.closed)) {
        const why = d.meals === 0 ? 'לא תועד' : 'לא נסגר';
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
        `<title>${esc(fmtDate(d.date))} · ${v} ${unit} · ${d.meals} ארוחות${d.closed ? ' · סגור' : ''}</title></rect>${xlab}`
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
  const closedOnly = chartDays === 'closed';
  // The margin is a CALORIE lens: oil and sauces hide calories, not protein.
  const margin: SafetyMargin = chartMetric === 'calories' ? chartMargin : 0;
  const days = recentDays(n, today, chartRange).map((d) =>
    margin > 0 ? { ...d, calories: withMargin(d.calories, margin) } : d,
  );
  const stats = intakeStats(days, closedOnly);
  const average = chartMetric === 'calories' ? stats.avgCalories : stats.avgProtein;
  const target = chartMetric === 'calories' ? n.targets.calories : n.targets.protein;
  const unit = chartMetric === 'calories' ? 'קלוריות' : 'ג׳';
  const lens = margin > 0 ? ` <bdi dir="ltr">+${margin}%</bdi>` : '';
  const anyOpen = !closedOnly && days.some((d) => d.meals > 0 && !d.closed);
  const gap =
    average !== null && target !== null && target > 0
      ? average > target
        ? ` <span class="nt-gap over">(${average - target} מעל היעד)</span>`
        : ` <span class="nt-gap">(${target - average} מתחת ליעד)</span>`
      : '';
  const legend =
    stats.tracked === 0
      ? closedOnly
        ? `<p class="empty nt-chart-empty">עוד אין ימים סגורים בטווח הזה — סוגרים יום בכפתור ✅ שבסיכום היומי</p>`
        : `<p class="empty nt-chart-empty">עוד אין ימים עם רישום בטווח הזה — הגרף מתחיל מהארוחה הראשונה</p>`
      : `<div class="chart-legend">
      <span class="cl-item"><i class="dot"></i>צריכה יומית${lens}</span>
      ${anyOpen ? `<span class="cl-item"><i class="dot open"></i>יום שלא נסגר</span>` : ''}
      <span class="cl-item"><i class="dot trend"></i>ממוצע${lens} <b>${average ?? 0} ${unit}</b>${gap} <span class="dim">(${stats.tracked} ${closedOnly ? 'ימים סגורים' : 'ימים עם רישום'})</span></span>
      ${target !== null ? `<span class="cl-item"><i class="dot goal"></i>יעד <b>${target} ${unit}</b></span>` : ''}
    </div>`;
  return `
  <section class="game-card nt-chart-card">
    <div class="gc-title">📊 הצריכה לאורך זמן <span class="gc-sub">${chartRange} ימים אחרונים</span></div>
    ${seg(INTAKE_METRICS, chartMetric, 'metric', 'מה להציג')}
    ${seg(INTAKE_RANGES, chartRange, 'range', 'טווח הגרף')}
    ${seg(INTAKE_DAYS, chartDays, 'days', 'אילו ימים')}
    ${chartMetric === 'calories' ? seg(INTAKE_MARGINS, chartMargin, 'margin', 'תוספת להערכת חסר') : ''}
    ${intakeChartSvg(days, chartMetric, average, target, today, closedOnly)}
    ${legend}
    <p class="gc-note dim">הזמן זורם מימין לשמאל — היום בקצה השמאלי. יום בלי רישום נשאר ריק ולא נספר בממוצע.${
      closedOnly ? ' ימים שלא נסגרו מוסתרים ולא נספרים.' : ' עמודה חלולה = יום שעוד לא נסגר.'
    }</p>
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

/* ---------------------------------------------------------- the reminders */

/** One Hebrew line per state of the 🔔 subscription on this device. */
export const PUSH_STATE_HE: Readonly<Record<PushResult, string>> = {
  unsupported: 'הדפדפן הזה לא תומך בהתראות. באנדרואיד: פותחים ב־Chrome ומוסיפים את האפליקציה למסך הבית.',
  signed_out: 'כדי לקבל תזכורות צריך להתחבר לחשבון (במסך ההגדרות).',
  denied: 'ההתראות חסומות לאפליקציה הזו. מאפשרים אותן בהגדרות האתר בדפדפן, וחוזרים לכאן.',
  off: 'כבויות במכשיר הזה.',
  on: 'פעילות במכשיר הזה ✅',
  failed: 'לא הצלחנו לשמור את ההרשמה בשרת — נסו שוב.',
};

/**
 * The 🔔 card: what the reminders do, and one button that turns them on or
 * off on THIS device. The state is asked of the port after render (it is
 * async), so the card first says "בודק…".
 */
function remindersCard(): string {
  const starts = MEAL_SLOTS.filter((s) => s.from !== null)
    .map((s) => `<bdi dir="ltr">${hourOf(s.from ?? '')}</bdi>`)
    .join(', ');
  return `
  <section class="game-card nt-remind">
    <div class="gc-title">🔔 תזכורות לארוחות</div>
    <p class="gc-note">התראה בתחילת כל חלון ארוחה (${starts}), עם הצעה מהתפריט. אם כבר רשמתם משהו באותה ארוחה, התזכורת מדלגת.</p>
    <p class="gc-note nt-remind-state" id="ntRemindState" role="status">בודק…</p>
    <button class="action-btn" id="ntRemindBtn" type="button" hidden></button>
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
    toast('היום נסגר ✅');
    again();
  });
  main.querySelector<HTMLButtonElement>('#ntReopen')?.addEventListener('click', () => {
    setDayClosed(deps.store, date, false);
    toast('היום נפתח להוספה');
    again();
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
    if (addMsg) addMsg.textContent = 'בחרו קודם לאיזו ארוחה להוסיף.';
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
      if (addMsg) addMsg.textContent = 'כמות לא תקינה — למשל 1, 0.5 או 1/2.';
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
      if (addMsg) addMsg.textContent = 'לא הצלחנו לרשום — בדקו את הבחירה.';
      return;
    }
    resetPick();
    clearDraft();
    toast('נרשם 📋');
    again();
  });

  /* ---- free text (and ✨) ---- */
  main.querySelector<HTMLButtonElement>('#ntAdd')?.addEventListener('click', () => {
    const name = (nameInp?.value ?? '').trim();
    const calories = intOf(calInp, MEAL_MAX_CALORIES);
    const protein = intOf(protInp, MEAL_MAX_PROTEIN);
    if (needSlot() || !slot) return;
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
      if (addMsg) addMsg.textContent = 'לא הצלחנו לרשום את הארוחה — בדקו את הפרטים.';
      return;
    }
    lastEstimate = null;
    photo = null;
    clearDraft();
    toast('הארוחה נרשמה 🍽️');
    again();
  });

  /* ---- 🔔 reminders ---- */
  const push = deps.push;
  const remindState = main.querySelector<HTMLElement>('#ntRemindState');
  const remindBtn = main.querySelector<HTMLButtonElement>('#ntRemindBtn');
  if (push && remindState && remindBtn) {
    let on = false;
    const show = (st: PushResult): void => {
      remindState.textContent = PUSH_STATE_HE[st];
      on = st === 'on';
      const actionable = st === 'on' || st === 'off' || st === 'failed';
      remindBtn.hidden = !actionable;
      remindBtn.disabled = false;
      remindBtn.textContent = on ? 'כיבוי תזכורות' : 'הפעלת תזכורות';
      remindBtn.classList.toggle('ghost', on);
    };
    void push.status().then(show, () => show('failed'));
    remindBtn.addEventListener('click', () => {
      remindBtn.disabled = true;
      remindState.textContent = on ? 'מכבה…' : 'מפעיל…';
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
        .estimate({ text, ...(photo ? { photo } : {}), catalog: catalogHints() })
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
          draft.cal = String(est.calories);
          draft.prot = String(est.proteinG);
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
