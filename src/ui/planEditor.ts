/**
 * ui/planEditor.ts — screen `'PL'` (תוכנית): edit the training plan.
 *
 * SHAPE OF THE SCREEN
 * -------------------
 * Day sub-tabs (A/B/C) → a list of rows for the selected day → one bottom sheet
 * for adding an exercise. Every row is a card with the name on top and the three
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
  DAY_ORDER,
  PROGRAM,
  equipHe,
  isDayKey,
  type BodyPart,
  type DayKey,
  type EquipmentKey,
} from '../data/program.ts';
import { isCustomId, type CustomExercise, type PlanDoc, type PlanExercise } from '../data/planTypes.ts';
import {
  EQUIPMENT_KEYS,
  NEW_ROW_DEFAULTS,
  PLAN_LIMITS,
  PLAN_UNITS,
  clonePlanDoc,
  defaultPlanDoc,
  isDefaultPlan,
  libraryExercises,
  makeResolver,
  newCustomId,
  planIsDirty,
  savePlan,
} from '../core/plan.ts';
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
let activeDay: DayKey = 'A';
type Sheet = 'closed' | 'library' | 'new';
let sheet: Sheet = 'closed';

/**
 * Drop the draft. `ui/app.ts` calls this whenever the editor is OPENED, so a
 * session always starts from what is actually saved — a stale draft from an
 * earlier visit must never be mistaken for the user's plan.
 */
export function resetPlanDraft(): void {
  draft = null;
  activeDay = 'A';
  sheet = 'closed';
}

/** The draft, created on demand from the saved plan (or the built-in program). */
function ensureDraft(store: DataStore): PlanDoc {
  if (!draft) draft = clonePlanDoc(store.getState().plan ?? defaultPlanDoc());
  return draft;
}

function rowsOf(doc: PlanDoc, day: DayKey): PlanExercise[] {
  const d = doc.days[day];
  if (!d) return [];
  return d.exercises;
}

/* ---------------------------------------------------------------- render */

function dayTabs(doc: PlanDoc): string {
  return `<div class="pl-days" role="tablist" aria-label="ימי האימון">
    ${DAY_ORDER.map((k) => {
      const on = k === activeDay;
      return `<button class="pl-day ${on ? 'active' : ''}" role="tab" aria-selected="${on}" data-day="${k}">
        <span class="pl-day-name">${PROGRAM[k].label}</span>
        <span class="pl-day-sub">${rowsOf(doc, k).length} תרגילים</span>
      </button>`;
    }).join('')}
  </div>`;
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
  const body = sheet === 'new' ? newExerciseForm() : libraryList(doc);
  return `<div class="pl-backdrop" id="plBackdrop"></div>
  <section class="pl-sheet" role="dialog" aria-modal="true" aria-label="הוספת תרגיל">
    <div class="pl-sheet-head">
      <h3>${sheet === 'new' ? 'תרגיל חדש' : `הוספת תרגיל · ${esc(PROGRAM[activeDay].label)}`}</h3>
      <button class="pl-mini" id="plSheetClose" aria-label="סגירת החלון">✕</button>
    </div>
    ${body}
  </section>`;
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
  const rows = rowsOf(doc, activeDay);
  const stored = deps.store.getState().plan;
  const dirty = planIsDirty(doc, stored);

  main.innerHTML = `
  <section class="plan-editor">
    ${dayTabs(doc)}
    <ol class="pl-rows">${rows.map((r, i) => rowHtml(doc, r, i, rows.length)).join('')}</ol>
    <button class="pl-add" id="plAdd">+ הוספת תרגיל</button>
    <div class="pl-actions">
      <button class="action-btn pl-save ${dirty ? 'dirty' : ''}" id="plSave">💾 שמירה</button>
      <button class="action-btn" id="plClose">סגירה</button>
    </div>
    <p class="gc-note pl-hint" id="plHint">${hintText(dirty, stored)}</p>
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
      if (!isDayKey(d)) return;
      activeDay = d;
      sheet = 'closed';
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
      if (!confirm(`להסיר את ${def ? def.he : id} מ${PROGRAM[activeDay].label}?`)) return;
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
  toast(`${custom.he} נוסף ל${PROGRAM[activeDay].label} ✨`);
  refresh();
}
