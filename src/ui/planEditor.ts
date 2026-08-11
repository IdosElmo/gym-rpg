/**
 * ui/planEditor.ts — screen `'PL'` (תוכנית): edit the training plan.
 *
 * SHAPE OF THE SCREEN
 * -------------------
 * Day sub-tabs (one per day the PLAN defines) → a list of rows for the selected
 * day → one bottom sheet for adding an exercise. Every row is a card with the name on top and the three
 * numbers (sets / reps / rest) below, because a phone in one hand cannot fit a
 * name AND three inputs on one line without shrinking the targets below the
 * thumb-friendly minimum.
 *
 * DRAFT SEMANTICS (deliberate, and the reason there is a 💾 button at all)
 * -----------------------------------------------------------------------
 * Every edit here mutates an IN-MEMORY draft; nothing reaches the store until
 * "שמירה" is pressed, and then exactly ONE `plan_updated` event is appended.
 * Live-saving each keystroke would flood the log (and, later, the sync outbox)
 * with dozens of full-document events per edit session, and would leave a
 * half-rearranged day as the user's real plan the moment they got distracted.
 *
 * The three inputs of a row do NOT re-render the screen — they write straight
 * into the draft — because re-rendering on every keystroke would steal focus
 * mid-number. Structural actions (add / remove / reorder / switch day) do
 * re-render, which is exactly when the DOM has to change anyway.
 */

import {
  BODY_PARTS,
  BODY_PART_HE,
  WEEKDAY_HE,
  WEEKDAY_SHORT_HE,
  equipHe,
  weekdaysCaption,
  type BodyPart,
  type DayKey,
  type EquipmentKey,
} from '../data/program.ts';
import {
  isCustomId,
  type CustomExercise,
  type PlanDay,
  type PlanDoc,
  type PlanExercise,
} from '../data/planTypes.ts';
import {
  EQUIPMENT_KEYS,
  NEW_ROW_DEFAULTS,
  PLAN_LIMITS,
  PLAN_UNITS,
  clonePlanDoc,
  defaultPlanDoc,
  deriveWeeklyTarget,
  isDefaultPlan,
  libraryExercises,
  makePlanDay,
  makeResolver,
  newCustomId,
  newDayKey,
  planDay,
  planIsDirty,
  planRows,
  savePlan,
} from '../core/plan.ts';
import { PLAN_PRESETS, presetById } from '../data/presets.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';

export interface PlanEditorDeps {
  store: DataStore;
  /** Re-render header + this screen in place (no scroll reset). */
  rerender: () => void;
  /** Leave the editor and go back where the user came from. */
  close: () => void;
}

/* ------------------------------------------------------------ draft state */

/** The unsaved document. `null` = "not editing yet"; built on first render. */
let draft: PlanDoc | null = null;
/**
 * Key of the day being edited. A plan defines its own days now, so this is a
 * string, and every read of it goes through `activeDayOf` — the day it names
 * may have been removed from the draft since it was set.
 */
let activeDay: DayKey = 'A';
type Sheet = 'closed' | 'library' | 'new' | 'presets';
let sheet: Sheet = 'closed';
/**
 * The one-line explanation of the last weekday move ("ראשון הועבר מחלק ב׳").
 *
 * A weekday belongs to AT MOST ONE day, so switching it on somewhere takes it
 * away somewhere else. That is a silent edit two tabs away, and a user who is
 * not told about it will believe the app dropped their schedule — hence a quiet
 * inline line rather than a toast (which would cover the chips they are using).
 */
let weekdayHint = '';

/** New days are born named; the user renames them in place. */
export const NEW_DAY_LABEL = 'אימון חדש';

/**
 * Drop the draft. `ui/app.ts` calls this whenever the editor is OPENED, so a
 * session always starts from what is actually saved — a stale draft from an
 * earlier visit must never be mistaken for the user's plan.
 */
export function resetPlanDraft(): void {
  draft = null;
  activeDay = 'A';
  sheet = 'closed';
  weekdayHint = '';
}

/** The day currently being edited — the first one when `activeDay` is stale. */
function activeDayOf(doc: PlanDoc): PlanDay {
  const day = planDay(doc, activeDay) ?? doc.days[0];
  if (!day) throw new Error('plan has no days');
  activeDay = day.key;
  return day;
}

/** Hebrew name of the day being edited (used in confirms and toasts). */
function activeLabel(doc: PlanDoc): string {
  return activeDayOf(doc).label;
}

/** The draft, created on demand from the saved plan (or the built-in program). */
function ensureDraft(store: DataStore): PlanDoc {
  if (!draft) draft = clonePlanDoc(store.getState().plan ?? defaultPlanDoc());
  return draft;
}

function rowsOf(doc: PlanDoc, day: DayKey): PlanExercise[] {
  return planRows(doc, day);
}

/* ---------------------------------------------------------------- render */

function dayTabs(doc: PlanDoc): string {
  const active = activeDayOf(doc).key;
  const full = doc.days.length >= PLAN_LIMITS.maxDays;
  return `<div class="pl-days-row">
    <div class="pl-days" role="tablist" aria-label="ימי האימון">
      ${doc.days
        .map((d) => {
          const on = d.key === active;
          return `<button class="pl-day ${on ? 'active' : ''}" role="tab" aria-selected="${on}" data-day="${esc(d.key)}">
          <span class="pl-day-name">${esc(d.label)}</span>
          <span class="pl-day-sub">${d.exercises.length} תרגילים</span>
        </button>`;
        })
        .join('')}
    </div>
    <button class="pl-day-add" id="plDayAdd" aria-label="הוספת יום אימון" ${full ? 'disabled' : ''}
      title="${full ? `עד ${PLAN_LIMITS.maxDays} ימי אימון` : 'הוספת יום אימון'}">＋</button>
  </div>`;
}

/**
 * The day's own settings: its name, its place in the tab order, its weekdays,
 * and the way out of it.
 *
 * It sits ABOVE the exercise rows because everything below it belongs to this
 * day — reading the screen top to bottom is then "this day, called this, trained
 * on these weekdays, made of these exercises".
 */
function dayCard(doc: PlanDoc, day: PlanDay): string {
  const idx = doc.days.findIndex((d) => d.key === day.key);
  const only = doc.days.length <= PLAN_LIMITS.minDays;
  const assigned = new Set(day.weekdays ?? []);
  const chips = WEEKDAY_SHORT_HE.map((short, wd) => {
    const on = assigned.has(wd);
    const name = WEEKDAY_HE[wd] ?? short;
    return `<button class="pl-wd ${on ? 'on' : ''}" data-wd="${wd}" aria-pressed="${on}"
      aria-label="${esc(name)}${on ? ' — משובץ' : ''}">${esc(short)}</button>`;
  }).join('');
  const caption = assigned.size > 0 ? `ימי אימון: ${weekdaysCaption([...assigned].sort((a, b) => a - b))}` : 'לא שובצו ימים בשבוע — היום הזה לא ייפתח אוטומטית';
  return `<section class="pl-day-card">
    <div class="pl-day-head">
      <label class="pl-field block pl-day-name-field">
        <span>שם היום</span>
        <input type="text" id="plDayLabel" maxlength="${PLAN_LIMITS.maxNameLength}" autocomplete="off"
          value="${esc(day.label)}" aria-label="שם יום האימון">
      </label>
      <div class="pl-move">
        <button class="pl-mini" id="plDayUp" aria-label="העבר את ${esc(day.label)} קדימה" ${idx <= 0 ? 'disabled' : ''}>▲</button>
        <button class="pl-mini" id="plDayDown" aria-label="העבר את ${esc(day.label)} אחורה" ${idx >= doc.days.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="pl-mini danger" id="plDayRemove" aria-label="הסרת ${esc(day.label)} מהתוכנית" ${only ? 'disabled' : ''}>🗑</button>
      </div>
    </div>
    <div class="pl-wds" role="group" aria-label="ימי השבוע של ${esc(day.label)}">${chips}</div>
    <p class="gc-note pl-wd-caption" id="plWdCaption">${esc(caption)}</p>
    ${weekdayHint ? `<p class="gc-note pl-wd-hint" id="plWdHint">${esc(weekdayHint)}</p>` : ''}
    <p class="gc-note pl-target" id="plTarget">${esc(targetText(doc))}</p>
  </section>`;
}

/** The derived streak target, spelled out — the reason the chips matter. */
function targetText(doc: PlanDoc): string {
  return `יעד שבועי: ${doc.weeklyTarget} ימי אימון (משפיע על רצף השבוע המושלם)`;
}

function rowHtml(doc: PlanDoc, row: PlanExercise, idx: number, total: number): string {
  const def = makeResolver(doc)(row.id);
  const name = def ? def.he : row.id;
  const en = def ? def.en : '';
  const unit = def ? def.unit : 'חזרות';
  const custom = isCustomId(row.id);
  return `<li class="pl-row" data-row="${esc(row.id)}">
    <div class="pl-row-head">
      <span class="pl-idx">${idx + 1}</span>
      <div class="pl-names">
        <b>${esc(name)}</b>
        ${en ? `<span class="pl-en">${esc(en)}</span>` : ''}
        ${custom ? '<span class="pl-badge">מותאם אישית</span>' : ''}
      </div>
      <div class="pl-move">
        <button class="pl-mini" data-up="${esc(row.id)}" aria-label="העבר את ${esc(name)} למעלה" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="pl-mini" data-down="${esc(row.id)}" aria-label="העבר את ${esc(name)} למטה" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
        <button class="pl-mini danger" data-remove="${esc(row.id)}" aria-label="הסר את ${esc(name)} מהתוכנית">🗑</button>
      </div>
    </div>
    <div class="pl-fields">
      <label class="pl-field">
        <span>סטים</span>
        <input type="number" inputmode="numeric" min="${PLAN_LIMITS.minSets}" max="${PLAN_LIMITS.maxSets}"
          value="${row.sets}" data-edit="sets" data-id="${esc(row.id)}">
      </label>
      <label class="pl-field wide">
        <span>${esc(unit)}</span>
        <input type="text" maxlength="${PLAN_LIMITS.maxRepsLength}" value="${esc(row.reps)}"
          data-edit="reps" data-id="${esc(row.id)}">
      </label>
      <label class="pl-field">
        <span>מנוחה (שנ׳)</span>
        <input type="number" inputmode="numeric" step="5" min="${PLAN_LIMITS.minRest}" max="${PLAN_LIMITS.maxRest}"
          value="${row.rest}" data-edit="rest" data-id="${esc(row.id)}">
      </label>
    </div>
  </li>`;
}

function sheetHtml(doc: PlanDoc): string {
  if (sheet === 'closed') return '';
  const body = sheet === 'new' ? newExerciseForm() : sheet === 'presets' ? presetList() : libraryList(doc);
  const title =
    sheet === 'new' ? 'תרגיל חדש' : sheet === 'presets' ? 'תוכניות מוכנות' : `הוספת תרגיל · ${esc(activeLabel(doc))}`;
  return `<div class="pl-backdrop" id="plBackdrop"></div>
  <section class="pl-sheet" role="dialog" aria-modal="true" aria-label="${sheet === 'presets' ? 'תוכניות מוכנות' : 'הוספת תרגיל'}">
    <div class="pl-sheet-head">
      <h3>${title}</h3>
      <button class="pl-mini" id="plSheetClose" aria-label="סגירת החלון">✕</button>
    </div>
    ${body}
  </section>`;
}

/** The ready-made plans. Picking one REPLACES the draft (after a confirm). */
function presetList(): string {
  const items = PLAN_PRESETS.map(
    (p) => `<li>
      <button class="pl-lib pl-preset" data-preset="${esc(p.id)}">
        <b>${esc(p.name)}</b>
        <span>${p.days} ימי אימון · ${esc(p.description)}</span>
      </button>
    </li>`,
  ).join('');
  return `<ul class="pl-lib-list">${items}</ul>
    <p class="gc-note dim">בחירה בתוכנית מוכנה מחליפה את הטיוטה הנוכחית. שום דבר לא נשמר עד לחיצה על 💾 שמירה, וההיסטוריה נשמרת בכל מקרה.</p>`;
}

function libraryList(doc: PlanDoc): string {
  const inDay = new Set(rowsOf(doc, activeDay).map((r) => r.id));
  const available = libraryExercises(doc).filter((ex) => !inDay.has(ex.id));
  const items = available
    .map(
      (ex) => `<li>
      <button class="pl-lib" data-add="${esc(ex.id)}">
        <b>${esc(ex.he)}</b>
        <span>${esc([ex.en, ex.muscle].filter(Boolean).join(' · '))}</span>
        ${isCustomId(ex.id) ? '<span class="pl-badge">מותאם אישית</span>' : ''}
      </button>
    </li>`,
    )
    .join('');
  return `
    ${items ? `<ul class="pl-lib-list">${items}</ul>` : '<p class="gc-note">כל התרגילים כבר נמצאים ביום הזה. אפשר ליצור תרגיל חדש. ✨</p>'}
    <button class="action-btn pl-new-btn" id="plNewToggle">✨ יצירת תרגיל חדש</button>`;
}

function newExerciseForm(): string {
  const parts = BODY_PARTS.map((p) => `<option value="${p}">${BODY_PART_HE[p]}</option>`).join('');
  const units = PLAN_UNITS.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  const chips = EQUIPMENT_KEYS.map(
    (k) => `<label class="pl-chip">
      <input type="checkbox" value="${esc(k)}" data-equip>
      <span>${esc(equipHe(k))}</span>
    </label>`,
  ).join('');
  return `<form class="pl-new" id="plNewForm" novalidate>
    <label class="pl-field block">
      <span>שם התרגיל (עברית) *</span>
      <input type="text" id="nxHe" maxlength="${PLAN_LIMITS.maxNameLength}" autocomplete="off" required>
    </label>
    <label class="pl-field block">
      <span>שם באנגלית (רשות)</span>
      <input type="text" id="nxEn" maxlength="${PLAN_LIMITS.maxNameLength}" autocomplete="off" dir="ltr">
    </label>
    <div class="pl-two">
      <label class="pl-field block">
        <span>חלק גוף עיקרי</span>
        <select id="nxPart">${parts}</select>
      </label>
      <label class="pl-field block">
        <span>חלק גוף משני (רשות)</span>
        <select id="nxPart2"><option value="">ללא</option>${parts}</select>
      </label>
    </div>
    <label class="pl-field block">
      <span>יחידת מדידה</span>
      <select id="nxUnit">${units}</select>
    </label>
    <fieldset class="pl-chips">
      <legend>ציוד</legend>
      ${chips}
    </fieldset>
    <p class="gc-note">חלק גוף משני מחלק את ה־XP ביחס 70/30 — בדיוק כמו בתרגילי התוכנית המקורית.</p>
    <div class="pl-new-actions">
      <button type="submit" class="action-btn">✨ הוספה לתוכנית</button>
      <button type="button" class="action-btn" id="nxCancel">ביטול</button>
    </div>
  </form>`;
}

export function renderPlanEditor(main: HTMLElement, deps: PlanEditorDeps): void {
  const doc = ensureDraft(deps.store);
  const day = activeDayOf(doc);
  const rows = day.exercises;
  const stored = deps.store.getState().plan;
  const dirty = planIsDirty(doc, stored);

  main.innerHTML = `
  <section class="plan-editor">
    ${dayTabs(doc)}
    ${dayCard(doc, day)}
    <ol class="pl-rows">${rows.map((r, i) => rowHtml(doc, r, i, rows.length)).join('')}</ol>
    ${rows.length === 0 ? '<p class="gc-note pl-empty">היום עדיין ריק — הוסיפו לפחות תרגיל אחד לפני השמירה. 🏋️</p>' : ''}
    <button class="pl-add" id="plAdd">+ הוספת תרגיל</button>
    <div class="pl-actions">
      <button class="action-btn pl-save ${dirty ? 'dirty' : ''}" id="plSave">💾 שמירה</button>
      <button class="action-btn" id="plClose">סגירה</button>
    </div>
    <p class="gc-note pl-hint" id="plHint">${hintText(dirty, stored)}</p>
    <button class="action-btn pl-presets" id="plPresets">📋 תוכניות מוכנות</button>
    <button class="action-btn danger pl-reset" id="plReset">איפוס לתוכנית המקורית</button>
    <p class="gc-note dim">שינוי התוכנית לא נוגע בהיסטוריה, ב־XP או בשיאים: כל אלה נשמרים לפי מזהה התרגיל, כך שאפשר לסדר מחדש, להסיר ולהחזיר תרגילים בלי לאבד כלום.</p>
  </section>
  ${sheetHtml(doc)}`;

  bind(main, deps);
}

function hintText(dirty: boolean, stored: PlanDoc | null): string {
  if (dirty) return '⚠️ יש שינויים שלא נשמרו — לחצו על 💾 שמירה.';
  return isDefaultPlan(stored) ? 'התוכנית זהה לתוכנית המקורית.' : 'התוכנית שמורה. ✓';
}

/* ---------------------------------------------------------------- wiring */

function bind(main: HTMLElement, deps: PlanEditorDeps): void {
  const doc = ensureDraft(deps.store);
  const refresh = (): void => deps.rerender();

  main.querySelectorAll<HTMLButtonElement>('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.dataset['day'];
      if (!d || !planDay(doc, d)) return;
      activeDay = d;
      sheet = 'closed';
      weekdayHint = '';
      refresh();
    });
  });

  /* ---------------------------------------------------- day management --- */
  main.querySelector<HTMLButtonElement>('#plDayAdd')?.addEventListener('click', () => {
    if (doc.days.length >= PLAN_LIMITS.maxDays) {
      toast(`עד ${PLAN_LIMITS.maxDays} ימי אימון בתוכנית.`);
      return;
    }
    const key = newDayKey();
    doc.days.push(makePlanDay(key, NEW_DAY_LABEL, [], []));
    doc.weeklyTarget = deriveWeeklyTarget(doc.days);
    activeDay = key;
    weekdayHint = '';
    // A day with no exercises cannot be saved, so the library opens immediately:
    // adding a day and choosing its first exercise is ONE gesture, not two.
    sheet = 'library';
    refresh();
  });

  // The name is written straight into the draft (a re-render would steal the
  // caret mid-word); only the tab above it is patched by hand to keep up.
  const nameInput = main.querySelector<HTMLInputElement>('#plDayLabel');
  nameInput?.addEventListener('input', () => {
    const day = activeDayOf(doc);
    day.label = nameInput.value.slice(0, PLAN_LIMITS.maxNameLength);
    const tab = [...main.querySelectorAll<HTMLElement>('.pl-day')]
      .find((t) => t.dataset['day'] === day.key)
      ?.querySelector<HTMLElement>('.pl-day-name');
    if (tab) tab.textContent = day.label;
    markDirty(main, deps);
  });
  nameInput?.addEventListener('change', () => {
    const day = activeDayOf(doc);
    if (!day.label.trim()) {
      day.label = NEW_DAY_LABEL;
      nameInput.value = day.label;
    }
    refresh();
  });

  main.querySelector<HTMLButtonElement>('#plDayUp')?.addEventListener('click', () => {
    moveDay(doc, -1);
    refresh();
  });
  main.querySelector<HTMLButtonElement>('#plDayDown')?.addEventListener('click', () => {
    moveDay(doc, 1);
    refresh();
  });
  main.querySelector<HTMLButtonElement>('#plDayRemove')?.addEventListener('click', () => {
    if (doc.days.length <= PLAN_LIMITS.minDays) {
      toast('התוכנית חייבת לכלול לפחות יום אימון אחד. 🗓');
      return;
    }
    const day = activeDayOf(doc);
    if (!confirm(`להסיר את ${day.label} מהתוכנית? אימונים שכבר תועדו ביום הזה יישארו בהיסטוריה — רק היום עצמו יורד מהתוכנית.`)) {
      return;
    }
    doc.days = doc.days.filter((d) => d.key !== day.key);
    doc.weeklyTarget = deriveWeeklyTarget(doc.days);
    activeDay = doc.days[0]?.key ?? '';
    weekdayHint = '';
    toast(`${day.label} הוסר מהתוכנית`);
    refresh();
  });

  /* ----------------------------------------------- weekday assignment --- */
  main.querySelectorAll<HTMLButtonElement>('[data-wd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wd = Number.parseInt(btn.dataset['wd'] ?? '', 10);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) return;
      toggleWeekday(doc, activeDayOf(doc), wd);
      refresh();
    });
  });

  /* ------- inline number/text edits: write to the draft, keep the focus ---- */
  main.querySelectorAll<HTMLInputElement>('[data-edit]').forEach((inp) => {
    const field = inp.dataset['edit'];
    const id = inp.dataset['id'];
    if (!id || (field !== 'sets' && field !== 'reps' && field !== 'rest')) return;
    const row = rowsOf(doc, activeDay).find((r) => r.id === id);
    if (!row) return;

    inp.addEventListener('input', () => {
      if (field === 'reps') row.reps = inp.value;
      else {
        const n = Number.parseInt(inp.value, 10);
        if (Number.isFinite(n)) row[field] = n;
      }
      markDirty(main, deps);
    });
    // Clamping happens on blur, not on keystroke: rewriting the value while the
    // user is still typing "12" would turn the first "1" into the minimum.
    inp.addEventListener('change', () => {
      if (field === 'reps') {
        row.reps = inp.value.trim() || NEW_ROW_DEFAULTS.reps;
        inp.value = row.reps;
      } else {
        const lo = field === 'sets' ? PLAN_LIMITS.minSets : PLAN_LIMITS.minRest;
        const hi = field === 'sets' ? PLAN_LIMITS.maxSets : PLAN_LIMITS.maxRest;
        const n = Number.parseInt(inp.value, 10);
        const fallback = field === 'sets' ? NEW_ROW_DEFAULTS.sets : NEW_ROW_DEFAULTS.rest;
        row[field] = Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : fallback));
        inp.value = String(row[field]);
      }
      markDirty(main, deps);
    });
  });

  /* --------------------------------------------------- reorder / remove --- */
  main.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => {
    b.addEventListener('click', () => {
      move(doc, b.dataset['up'] ?? '', -1);
      refresh();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-down]').forEach((b) => {
    b.addEventListener('click', () => {
      move(doc, b.dataset['down'] ?? '', 1);
      refresh();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset['remove'];
      if (!id) return;
      const rows = rowsOf(doc, activeDay);
      const def = makeResolver(doc)(id);
      if (rows.length <= 1) {
        toast('חייב להישאר לפחות תרגיל אחד ביום. 🏋️');
        return;
      }
      if (!confirm(`להסיר את ${def ? def.he : id} מ${activeLabel(doc)}?`)) return;
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
      refresh();
    });
  });

  /* ------------------------------------------------------- the add sheet -- */
  main.querySelector<HTMLButtonElement>('#plAdd')?.addEventListener('click', () => {
    sheet = 'library';
    refresh();
  });
  main.querySelector<HTMLButtonElement>('#plSheetClose')?.addEventListener('click', () => {
    sheet = 'closed';
    refresh();
  });
  main.querySelector<HTMLElement>('#plBackdrop')?.addEventListener('click', () => {
    sheet = 'closed';
    refresh();
  });
  main.querySelector<HTMLButtonElement>('#plNewToggle')?.addEventListener('click', () => {
    sheet = 'new';
    refresh();
  });

  /* --------------------------------------------------------- presets ---- */
  main.querySelector<HTMLButtonElement>('#plPresets')?.addEventListener('click', () => {
    sheet = 'presets';
    refresh();
  });
  main.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
    b.addEventListener('click', () => {
      const preset = presetById(b.dataset['preset'] ?? '');
      if (!preset) return;
      // A preset REPLACES the whole draft, so it asks first — and it still only
      // touches the draft: the plan on disk changes when 💾 is pressed, not now.
      if (!confirm(`להחליף את התוכנית שבעריכה ב"${preset.name}"? כל שינוי שלא נשמר יאבד.`)) return;
      draft = clonePlanDoc(preset.build());
      activeDay = draft.days[0]?.key ?? '';
      sheet = 'closed';
      weekdayHint = '';
      toast(`${preset.name} נטענה — לחצו 💾 שמירה כדי להחיל אותה`);
      refresh();
    });
  });
  main.querySelector<HTMLButtonElement>('#nxCancel')?.addEventListener('click', () => {
    sheet = 'library';
    refresh();
  });
  main.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset['add'];
      if (!id) return;
      addRow(doc, id);
      sheet = 'closed';
      refresh();
    });
  });
  main.querySelector<HTMLFormElement>('#plNewForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitNewExercise(main, doc, refresh);
  });

  /* ------------------------------------------------------- save / reset --- */
  main.querySelector<HTMLButtonElement>('#plSave')?.addEventListener('click', () => {
    const res = savePlan(deps.store, doc);
    if (!res.ok) {
      toast(res.errors[0] ?? 'התוכנית אינה תקינה');
      return;
    }
    draft = clonePlanDoc(res.plan ?? defaultPlanDoc());
    toast('התוכנית נשמרה ✓');
    refresh();
  });

  main.querySelector<HTMLButtonElement>('#plReset')?.addEventListener('click', () => {
    if (!confirm('לאפס את התוכנית חזרה לתוכנית המקורית? התרגילים המותאמים אישית יוסרו מהתוכנית (ההיסטוריה נשמרת).')) {
      return;
    }
    savePlan(deps.store, null);
    draft = clonePlanDoc(defaultPlanDoc());
    sheet = 'closed';
    toast('התוכנית אופסה לתוכנית המקורית ✓');
    refresh();
  });

  main.querySelector<HTMLButtonElement>('#plClose')?.addEventListener('click', () => deps.close());
}

/** Update just the dirty hint — an inline edit must not re-render the screen. */
function markDirty(main: HTMLElement, deps: PlanEditorDeps): void {
  const doc = ensureDraft(deps.store);
  const stored = deps.store.getState().plan;
  const dirty = planIsDirty(doc, stored);
  const hint = main.querySelector<HTMLElement>('#plHint');
  if (hint) hint.textContent = hintText(dirty, stored);
  main.querySelector<HTMLButtonElement>('#plSave')?.classList.toggle('dirty', dirty);
}

/** Move the active day in the array — that array IS the tab order. */
function moveDay(doc: PlanDoc, delta: number): void {
  const idx = doc.days.findIndex((d) => d.key === activeDay);
  const next = idx + delta;
  if (idx < 0 || next < 0 || next >= doc.days.length) return;
  const a = doc.days[idx];
  const b = doc.days[next];
  if (!a || !b) return;
  doc.days[idx] = b;
  doc.days[next] = a;
}

/**
 * Toggle one weekday on the active day, keeping the map EXCLUSIVE: a weekday
 * belongs to at most one workout, so switching it on here switches it off
 * wherever it was (and says so, via `weekdayHint`).
 *
 * Two days claiming the same weekday would make `defaultDay` pick whichever came
 * first in the array — a coin toss the user never asked for — and would make the
 * derived weekly target smaller than the number of workouts it describes.
 */
function toggleWeekday(doc: PlanDoc, day: PlanDay, wd: number): void {
  const current = day.weekdays ?? [];
  weekdayHint = '';
  if (current.includes(wd)) {
    day.weekdays = current.filter((w) => w !== wd);
  } else {
    const owner = doc.days.find((d) => d.key !== day.key && (d.weekdays ?? []).includes(wd));
    if (owner) {
      owner.weekdays = (owner.weekdays ?? []).filter((w) => w !== wd);
      if (owner.weekdays.length === 0) delete owner.weekdays;
      weekdayHint = `${WEEKDAY_HE[wd] ?? ''} הועבר מ${owner.label}`;
    }
    day.weekdays = [...current, wd].sort((a, b) => a - b);
  }
  // An empty list is stored as NO field at all, exactly like `makePlanDay` does,
  // so a document compares equal to itself after a save round trip.
  if ((day.weekdays ?? []).length === 0) delete day.weekdays;
  doc.weeklyTarget = deriveWeeklyTarget(doc.days);
}

function move(doc: PlanDoc, id: string, delta: number): void {
  const rows = rowsOf(doc, activeDay);
  const idx = rows.findIndex((r) => r.id === id);
  const next = idx + delta;
  if (idx < 0 || next < 0 || next >= rows.length) return;
  const a = rows[idx];
  const b = rows[next];
  if (!a || !b) return;
  rows[idx] = b;
  rows[next] = a;
}

function addRow(doc: PlanDoc, id: string): void {
  const rows = rowsOf(doc, activeDay);
  if (rows.some((r) => r.id === id)) return;
  if (rows.length >= PLAN_LIMITS.maxExercisesPerDay) {
    toast(`עד ${PLAN_LIMITS.maxExercisesPerDay} תרגילים ליום.`);
    return;
  }
  const def = makeResolver(doc)(id);
  rows.push({
    id,
    sets: def ? def.sets : NEW_ROW_DEFAULTS.sets,
    reps: def && def.reps ? def.reps : NEW_ROW_DEFAULTS.reps,
    rest: def ? def.rest : NEW_ROW_DEFAULTS.rest,
  });
}

function isBodyPart(v: string): v is BodyPart {
  return (BODY_PARTS as readonly string[]).includes(v);
}

function isEquipmentKey(v: string): v is EquipmentKey {
  return (EQUIPMENT_KEYS as readonly string[]).includes(v);
}

/** Read the ✨ form, validate it, and add both the definition and the row. */
function submitNewExercise(main: HTMLElement, doc: PlanDoc, refresh: () => void): void {
  const val = (id: string): string => main.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '';
  const sel = (id: string): string => main.querySelector<HTMLSelectElement>(`#${id}`)?.value ?? '';

  const he = val('nxHe').trim();
  if (!he) {
    toast('צריך שם בעברית לתרגיל החדש.');
    main.querySelector<HTMLInputElement>('#nxHe')?.focus();
    return;
  }
  const primaryRaw = sel('nxPart');
  const bodyPart: BodyPart = isBodyPart(primaryRaw) ? primaryRaw : 'chest';
  const secondaryRaw = sel('nxPart2');
  const secondary = isBodyPart(secondaryRaw) && secondaryRaw !== bodyPart ? secondaryRaw : null;
  const unit = sel('nxUnit') || 'חזרות';
  const equip: EquipmentKey[] = [];
  main.querySelectorAll<HTMLInputElement>('[data-equip]').forEach((c) => {
    if (c.checked && isEquipmentKey(c.value)) equip.push(c.value);
  });

  const custom: CustomExercise = {
    id: newCustomId(),
    he: he.slice(0, PLAN_LIMITS.maxNameLength),
    en: val('nxEn').trim().slice(0, PLAN_LIMITS.maxNameLength),
    bodyPart,
    unit,
    equip: equip.length > 0 ? equip : ['Bodyweight'],
    muscle: BODY_PART_HE[bodyPart],
  };
  // A secondary part is stored as the same 70/30 split the built-in compound
  // lifts use, so custom exercises feed the character exactly like real ones.
  if (secondary) custom.split = { [bodyPart]: 0.7, [secondary]: 0.3 };

  doc.customExercises.push(custom);
  addRow(doc, custom.id);
  sheet = 'closed';
  toast(`${custom.he} נוסף ל${activeLabel(doc)} ✨`);
  refresh();
}
