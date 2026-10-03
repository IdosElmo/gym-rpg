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
  isCardio,
  weekdaysCaption,
  type BodyPart,
  type DayKey,
  type EquipmentKey,
  type Exercise,
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
  collapseRoutingRanges,
  customToExercise,
  defaultPlanDoc,
  deleteUserPreset,
  deriveWeeklyTarget,
  displayDayLabel,
  instantiateUserPreset,
  isBuiltInWeekdayMap,
  isDefaultPlan,
  isSuperset,
  legalPairs,
  libraryExercises,
  makePlanDay,
  makeResolver,
  maxSetsOf,
  newCustomId,
  newDayKey,
  planDay,
  planIsDirty,
  planRows,
  savePlan,
  saveUserPreset,
  supersetPairs,
  supersetPartner,
  userPresetList,
  type SupersetPair,
} from '../core/plan.ts';
import { PLAN_PRESETS, presetById } from '../data/presets.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { esc, escBidi } from './dom.ts';
import { mountExerciseDemo, type DemoHandle } from './exerciseDemo.ts';
import { toast } from './toast.ts';
import { locale, tr } from '../i18n/locale.ts';
import { weekdayName, weekdayOrder, weekdayShort } from '../i18n/format.ts';
import {
  bodyPartName,
  equipName,
  exCue,
  exMuscle,
  exName,
  exSubName,
  exUnit,
  repsText,
  unitWord,
} from '../i18n/content.ts';
import { plan as P } from '../i18n/messages/plan.ts';
import { workout as W } from '../i18n/messages/workout.ts';

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
 * The exercise whose PREVIEW CARD is open in the library sheet, or `null`.
 *
 * Tapping a name in the library does not add it: fifty names are a lot to
 * tell apart by text, and half of them are a choice between two lifts. So a
 * tap opens the exercise under its own row — the coach demo the workout
 * screen shows, the equipment, the muscle, the scheme — and ONE button on
 * that card is what adds. The demo is mounted after each render into the
 * card's host and torn down before the next one (`preview`), the same
 * handle discipline `ui/workout.ts` keeps.
 */
let picked: string | null = null;
let preview: DemoHandle | null = null;
/**
 * The one-line explanation of the last weekday move ("ראשון הועבר מחלק ב׳").
 *
 * A weekday belongs to AT MOST ONE day, so switching it on somewhere takes it
 * away somewhere else. That is a silent edit two tabs away, and a user who is
 * not told about it will believe the app dropped their schedule — hence a quiet
 * inline line rather than a toast (which would cover the chips they are using).
 */
let weekdayHint = '';

/**
 * New days are born named; the user renames them in place. (The Hebrew name;
 * a day added in another language is born with that language's — `newDayLabel`.)
 */
export const NEW_DAY_LABEL = P.he.newDayLabel;

/** The name a day added right now is born with — the reader's language. */
function newDayLabel(): string {
  return tr(P).newDayLabel;
}

/**
 * Drop the draft. `ui/app.ts` calls this whenever the editor is OPENED, so a
 * session always starts from what is actually saved — a stale draft from an
 * earlier visit must never be mistaken for the user's plan.
 */
export function resetPlanDraft(seed: PlanDoc | null = null): void {
  // `seed`: start from this document instead of the saved plan (an EMPTY plan
  // starts the editor from one empty day — see core/onboarding.ts#blankPlanDoc).
  draft = seed ? clonePlanDoc(seed) : null;
  activeDay = seed?.days[0]?.key ?? 'A';
  sheet = 'closed';
  weekdayHint = '';
  picked = null;
  preview?.destroy();
  preview = null;
}

/** The day currently being edited — the first one when `activeDay` is stale. */
function activeDayOf(doc: PlanDoc): PlanDay {
  const day = planDay(doc, activeDay) ?? doc.days[0];
  if (!day) throw new Error('plan has no days');
  activeDay = day.key;
  return day;
}

/** Name of the day being edited, as shown (used in confirms and toasts). */
function activeLabel(doc: PlanDoc): string {
  return dayLabel(activeDayOf(doc));
}

/** A plan day's name as the screen shows it (see `displayDayLabel`). */
function dayLabel(day: PlanDay): string {
  return displayDayLabel(day.key, day.label);
}

/** An exercise's name by id, through the draft (customs included). */
function nameOf(doc: PlanDoc, id: string): string {
  const def = makeResolver(doc)(id);
  return def ? exName(def) : id;
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
  const D = tr(P).days;
  return `<div class="pl-days-row">
    <div class="pl-days" role="tablist" aria-label="${esc(D.tabsLabel)}">
      ${doc.days
        .map((d) => {
          const on = d.key === active;
          return `<button class="pl-day ${on ? 'active' : ''}" role="tab" aria-selected="${on}" data-day="${esc(d.key)}">
          <span class="pl-day-name">${esc(dayLabel(d))}</span>
          <span class="pl-day-sub">${D.exercises(d.exercises.length)}</span>
        </button>`;
        })
        .join('')}
    </div>
    <button class="pl-day-add" id="plDayAdd" aria-label="${esc(D.add)}" ${full ? 'disabled' : ''}
      title="${esc(full ? D.max(PLAN_LIMITS.maxDays) : D.add)}">＋</button>
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
  const D = tr(P).days;
  const label = dayLabel(day);
  // DISPLAY order only (Monday first in English); `data-wd` stays the
  // Sunday-based index the plan stores.
  const chips = weekdayOrder()
    .map((wd) => {
      const on = assigned.has(wd);
      const short = weekdayShort(wd);
      const name = weekdayName(wd) || short;
      return `<button class="pl-wd ${on ? 'on' : ''}" data-wd="${wd}" aria-pressed="${on}"
      aria-label="${esc(name)}${on ? esc(D.assigned) : ''}">${esc(short)}</button>`;
    })
    .join('');
  const caption = assigned.size > 0 ? D.caption(weekdaysCaption([...assigned].sort((a, b) => a - b))) : D.unscheduled;
  return `<section class="pl-day-card">
    <div class="pl-day-head">
      <label class="pl-field block pl-day-name-field">
        <span>${D.nameField}</span>
        <input type="text" id="plDayLabel" maxlength="${PLAN_LIMITS.maxNameLength}" autocomplete="off"
          value="${esc(label)}" aria-label="${esc(D.nameLabel)}">
      </label>
      <div class="pl-move">
        <button class="pl-mini" id="plDayUp" aria-label="${esc(D.up(label))}" ${idx <= 0 ? 'disabled' : ''}>▲</button>
        <button class="pl-mini" id="plDayDown" aria-label="${esc(D.down(label))}" ${idx >= doc.days.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="pl-mini danger" id="plDayRemove" aria-label="${esc(D.remove(label))}" ${only ? 'disabled' : ''}>🗑</button>
      </div>
    </div>
    <div class="pl-wds" role="group" aria-label="${esc(D.weekdaysOf(label))}">${chips}</div>
    <p class="gc-note pl-wd-caption" id="plWdCaption">${esc(caption)}</p>
    ${weekdayHint ? `<p class="gc-note pl-wd-hint" id="plWdHint">${esc(weekdayHint)}</p>` : ''}
    <p class="gc-note pl-target" id="plTarget">${esc(targetText(doc))}</p>
  </section>`;
}

/** The derived streak target, spelled out — the reason the chips matter. */
function targetText(doc: PlanDoc): string {
  return tr(P).days.target(doc.weeklyTarget);
}

/**
 * ONE row card. `tag` is `li` for a row that stands on its own (the row IS the
 * list item) and `div` for a row inside a `.pl-ss-pair` — the pair is then the
 * list item, which is what keeps the list valid HTML while a superset renders
 * as one bracketed block.
 *
 * `shared` marks the two fields a superset SHARES (sets + rest): both rows show
 * the same number and editing either one moves both, so they are drawn as one
 * value rather than as two that happen to agree.
 */
function rowHtml(
  doc: PlanDoc,
  row: PlanExercise,
  idx: number,
  total: number,
  tag: 'li' | 'div' = 'li',
  shared = false,
): string {
  const def = makeResolver(doc)(row.id);
  const R = tr(P).row;
  const name = def ? exName(def) : row.id;
  const en = def ? exSubName(def) : '';
  const unit = def ? exUnit(def) : unitWord('חזרות');
  const custom = isCustomId(row.id);
  const sh = shared ? ' rest-shared' : '';
  // A cardio row keeps the three fields and renames them: its sets are STAGES
  // and its rest is the length of one (the stage timer) — see `CardioSpec`.
  const cardio = isCardio(def);
  return `<${tag} class="pl-row" data-row="${esc(row.id)}">
    <div class="pl-row-head">
      <span class="pl-idx">${idx + 1}</span>
      <div class="pl-names">
        <b>${esc(name)}</b>
        ${en ? `<span class="pl-en">${esc(en)}</span>` : ''}
        ${custom ? `<span class="pl-badge">${R.custom}</span>` : ''}
        ${cardio ? `<span class="pl-badge">${R.cardio}</span>` : ''}
      </div>
      <div class="pl-move">
        <button class="pl-mini" data-up="${esc(row.id)}" aria-label="${esc(R.up(name))}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="pl-mini" data-down="${esc(row.id)}" aria-label="${esc(R.down(name))}" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
        <button class="pl-mini danger" data-remove="${esc(row.id)}" aria-label="${esc(R.remove(name))}">🗑</button>
      </div>
    </div>
    <div class="pl-fields">
      <label class="pl-field${sh}">
        <span>${cardio ? R.stages : R.sets}</span>
        <input type="number" inputmode="numeric" min="${PLAN_LIMITS.minSets}" max="${maxSetsOf(def)}"
          value="${row.sets}" data-edit="sets" data-id="${esc(row.id)}">
      </label>
      <label class="pl-field wide">
        <span>${esc(unit)}</span>
        <input type="text" maxlength="${PLAN_LIMITS.maxRepsLength}" value="${esc(repsText(row.reps))}"
          data-edit="reps" data-id="${esc(row.id)}">
      </label>
      <label class="pl-field${sh}">
        <span>${cardio ? R.stageLength : R.rest}</span>
        <input type="number" inputmode="numeric" step="5" min="${PLAN_LIMITS.minRest}" max="${PLAN_LIMITS.maxRest}"
          value="${row.rest}" data-edit="rest" data-id="${esc(row.id)}">
      </label>
    </div>
  </${tag}>`;
}

/* --------------------------------------------------------- superset rows */

/**
 * The day's rows, with every superset welded into ONE bracketed block and a 🔗
 * control between every two adjacent rows.
 *
 * The control is what CREATES a link, so it lives between the rows it would
 * join — the gesture and the result are in the same place. A row that is
 * already half of a superset shows the control DISABLED toward its other
 * neighbours: an exercise belongs to at most one pair, and hiding the control
 * outright would make the list jump around as pairs are made and broken.
 */
function rowsHtml(doc: PlanDoc, day: PlanDay): string {
  const rows = day.exercises;
  const out: string[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row) break;
    const next = rows[i + 1];
    const pair = supersetPairs(day).find((p) => p[0] === row.id);
    if (pair && next && next.id === pair[1]) {
      out.push(pairHtml(doc, row, next, i, rows.length));
      i += 2;
    } else {
      out.push(rowHtml(doc, row, i, rows.length));
      i += 1;
    }
    // …and the control toward whatever comes next, if anything does.
    const last = rows[i - 1];
    const after = rows[i];
    if (last && after) out.push(linkHtml(doc, day, last, after));
  }
  return out.join('');
}

/** The dashed "🔗 צרו סופר־סט" pill between two rows that are not linked. */
function linkHtml(doc: PlanDoc, day: PlanDay, a: PlanExercise, b: PlanExercise): string {
  const S = tr(P).superset;
  const nameA = nameOf(doc, a.id);
  const nameB = nameOf(doc, b.id);
  const taken = isSuperset(day, a.id) || isSuperset(day, b.id);
  const title = taken ? S.taken : S.link(nameA, nameB);
  return `<li class="pl-sslink">
    <button type="button" data-sslink="${esc(a.id)}" ${taken ? 'disabled' : ''}
      title="${esc(title)}" aria-label="${esc(title)}">${S.linkBtn}</button>
  </li>`;
}

/** Two linked rows: one violet bracket, one shared rest, one way out of it. */
function pairHtml(doc: PlanDoc, a: PlanExercise, b: PlanExercise, idx: number, total: number): string {
  const S = tr(P).superset;
  const nameA = nameOf(doc, a.id);
  const nameB = nameOf(doc, b.id);
  return `<li class="pl-ss-pair" data-ss-pair="${esc(a.id)}">
    <span class="pl-ss-tag">${S.tag}</span>
    ${rowHtml(doc, a, idx, total, 'div', true)}
    <div class="pl-sslink on">
      <button type="button" data-ssunlink="${esc(a.id)}"
        aria-label="${esc(S.unlink(nameA, nameB))}">${S.unlinkBtn}</button>
    </div>
    ${rowHtml(doc, b, idx + 1, total, 'div', true)}
    <div class="pl-ss-rest-note">${S.restNote}</div>
  </li>`;
}

function sheetHtml(doc: PlanDoc, store: DataStore): string {
  if (sheet === 'closed') return '';
  const body = sheet === 'new' ? newExerciseForm() : sheet === 'presets' ? presetList(store) : libraryList(doc);
  const T = tr(P).sheet;
  const title =
    sheet === 'new' ? T.newTitle : sheet === 'presets' ? T.presetsTitle : T.addTitle(esc(activeLabel(doc)));
  return `<div class="pl-backdrop" id="plBackdrop"></div>
  <section class="pl-sheet" role="dialog" aria-modal="true" aria-label="${esc(sheet === 'presets' ? T.presetsTitle : T.addLabel)}">
    <div class="pl-sheet-head">
      <h3>${title}</h3>
      <button class="pl-mini" id="plSheetClose" aria-label="${esc(T.close)}">✕</button>
    </div>
    ${body}
  </section>`;
}

/**
 * The ready-made plans, and below them the user's OWN saved ones. Picking
 * either REPLACES the draft (after a confirm); the ⭐ button freezes the
 * current draft under a name, so "my plan" becomes a preset too.
 */
function presetList(store: DataStore): string {
  const T = tr(P).presets;
  const items = PLAN_PRESETS.map(
    (p) => `<li>
      <button class="pl-lib pl-preset" data-preset="${esc(p.id)}">
        <b>${esc(p.name)}</b>
        <span>${T.days(p.days)} · ${esc(p.description)}</span>
      </button>
    </li>`,
  ).join('');
  const mine = userPresetList(store.getState())
    .map(
      ({ id, preset }) => `<li class="pl-mypreset">
      <button class="pl-lib pl-preset" data-user-preset="${esc(id)}">
        <b>${esc(preset.name)}</b>
        <span>${T.days(preset.plan.days.length)} · ${T.mine}</span>
      </button>
      <button class="pl-mini danger pl-preset-del" data-preset-del="${esc(id)}" aria-label="${esc(T.remove(preset.name))}">🗑</button>
    </li>`,
    )
    .join('');
  return `<ul class="pl-lib-list">${items}</ul>
    ${mine ? `<h4 class="pl-mine-title">${T.mineTitle}</h4><ul class="pl-lib-list">${mine}</ul>` : ''}
    <button class="action-btn pl-save-preset" id="plSavePreset">${T.saveCurrent}</button>
    <p class="gc-note dim">${T.note}</p>`;
}

/**
 * The library in the order the sheet lists it: alphabetical by the name it
 * SHOWS. `libraryExercises` already sorts by the Hebrew name; any other
 * language re-sorts by its own (stable, so equal names keep their order).
 */
function libraryInOrder(doc: PlanDoc): Exercise[] {
  const list = libraryExercises(doc);
  if (locale() === 'he') return list;
  return list
    .map((ex) => ({ ex, name: exName(ex) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map((e) => e.ex);
}

function libraryList(doc: PlanDoc): string {
  const inDay = new Set(rowsOf(doc, activeDay).map((r) => r.id));
  const L = tr(P).library;
  const available = libraryInOrder(doc).filter((ex) => !inDay.has(ex.id));
  // a card can only be open on something the list still offers
  if (picked !== null && !available.some((ex) => ex.id === picked)) picked = null;
  const items = available
    .map((ex) => {
      const open = ex.id === picked;
      return `<li${open ? ' class="pl-lib-open"' : ''}>
      <button class="pl-lib" data-pick="${esc(ex.id)}" aria-expanded="${open ? 'true' : 'false'}">
        <b>${escBidi(exName(ex))}</b>
        <span>${esc([exSubName(ex), exMuscle(ex)].filter(Boolean).join(' · '))}</span>
        ${isCustomId(ex.id) ? `<span class="pl-badge">${tr(P).row.custom}</span>` : ''}
      </button>
      ${open ? previewCard(ex) : ''}
    </li>`;
    })
    .join('');
  return `
    ${items ? `<ul class="pl-lib-list">${items}</ul>` : `<p class="gc-note">${L.allIn}</p>`}
    <button class="action-btn pl-new-btn" id="plNewToggle">${L.newBtn}</button>`;
}

/**
 * THE PREVIEW CARD under a picked library row: the coach demo (mounted into
 * `#plPreviewDemo` by `renderPlanEditor`, because a demo is a live element and
 * not a string), the equipment · muscle · scheme line, the cue, and the one
 * button that adds. A custom exercise has no demo on purpose (`demoFor`
 * explains why a stand-in would be a guess), so its card says so and still
 * offers the button.
 */
function previewCard(ex: Exercise): string {
  const L = tr(P).library;
  const reps = repsText(ex.reps);
  const scheme = isCardio(ex) ? L.stages(ex.sets, reps) : `${ex.sets} × ${reps}`;
  const meta = [ex.equip.map(equipName).join(' / '), exMuscle(ex), scheme].filter(Boolean).join(' · ');
  const cue = exCue(ex);
  const demo = isCustomId(ex.id)
    ? `<p class="gc-note dim pl-preview-nodemo">${L.noDemo}</p>`
    : '<div class="pl-preview-demo" id="plPreviewDemo"></div>';
  return `<div class="pl-preview" data-preview="${esc(ex.id)}">
      ${demo}
      <p class="pl-preview-meta">${esc(meta)}</p>
      ${cue ? `<p class="pl-preview-cue">${esc(cue)}</p>` : ''}
      <div class="pl-preview-actions">
        <button class="action-btn pl-add-confirm" data-add="${esc(ex.id)}">${L.add}</button>
        <button class="pl-mini pl-unpick" data-unpick aria-label="${esc(L.closePreview)}">✕</button>
      </div>
    </div>`;
}

/**
 * The ✨ form. A custom exercise stores a `he` name (required — it is the name
 * every screen falls back to) and an optional `en` one. In Hebrew the form asks
 * for exactly that. In English the FIRST field is the name the reader types in
 * their own language: it is stored as `en` (which `exName` shows in English)
 * and also as `he` unless a Hebrew name is given in the second field — so the
 * exercise always has the required name and shows sensibly in both languages.
 * The `dir="ltr"` sits on whichever field holds the English name.
 */
function newExerciseForm(): string {
  const F = tr(P).form;
  const en = locale() === 'en';
  const parts = BODY_PARTS.map((p) => `<option value="${p}">${esc(bodyPartName(p))}</option>`).join('');
  // the option VALUE is the program's own unit word (what is stored); the text is the reader's
  const units = PLAN_UNITS.map((u) => `<option value="${esc(u)}">${esc(unitWord(u))}</option>`).join('');
  const chips = EQUIPMENT_KEYS.map(
    (k) => `<label class="pl-chip">
      <input type="checkbox" value="${esc(k)}" data-equip>
      <span>${esc(equipName(k))}</span>
    </label>`,
  ).join('');
  return `<form class="pl-new" id="plNewForm" novalidate>
    <label class="pl-field block">
      <span>${F.name}</span>
      <input type="text" id="nxHe" maxlength="${PLAN_LIMITS.maxNameLength}" autocomplete="off" required${en ? ' dir="ltr"' : ''}>
    </label>
    <label class="pl-field block">
      <span>${F.second}</span>
      <input type="text" id="nxEn" maxlength="${PLAN_LIMITS.maxNameLength}" autocomplete="off"${en ? ' dir="rtl" lang="he"' : ' dir="ltr"'}>
    </label>
    <div class="pl-two">
      <label class="pl-field block">
        <span>${F.part}</span>
        <select id="nxPart">${parts}</select>
      </label>
      <label class="pl-field block">
        <span>${F.part2}</span>
        <select id="nxPart2"><option value="">${F.none}</option>${parts}</select>
      </label>
    </div>
    <label class="pl-field block">
      <span>${F.unit}</span>
      <select id="nxUnit">${units}</select>
    </label>
    <fieldset class="pl-chips">
      <legend>${F.equip}</legend>
      ${chips}
    </fieldset>
    <p class="gc-note">${F.note}</p>
    <div class="pl-new-actions">
      <button type="submit" class="action-btn">${F.submit}</button>
      <button type="button" class="action-btn" id="nxCancel">${F.cancel}</button>
    </div>
  </form>`;
}

export function renderPlanEditor(main: HTMLElement, deps: PlanEditorDeps): void {
  const doc = ensureDraft(deps.store);
  const day = activeDayOf(doc);
  const rows = day.exercises;
  const stored = deps.store.getState().plan;
  const dirty = planIsDirty(doc, stored);
  const E = tr(P).editor;

  main.innerHTML = `
  <section class="plan-editor">
    ${dayTabs(doc)}
    ${dayCard(doc, day)}
    <ol class="pl-rows">${rowsHtml(doc, day)}</ol>
    ${rows.length === 0 ? `<p class="gc-note pl-empty">${E.empty}</p>` : ''}
    <button class="pl-add" id="plAdd">${E.add}</button>
    <div class="pl-actions">
      <button class="action-btn pl-save ${dirty ? 'dirty' : ''}" id="plSave">${E.save}</button>
      <button class="action-btn" id="plClose">${E.close}</button>
    </div>
    <p class="gc-note pl-hint" id="plHint">${hintText(dirty, stored)}</p>
    <button class="action-btn pl-presets" id="plPresets">${E.presets}</button>
    <button class="action-btn danger pl-reset" id="plReset">${E.reset}</button>
    <p class="gc-note dim">${E.note}</p>
  </section>
  ${sheetHtml(doc, deps.store)}`;

  // The preview demo is a LIVE element: it is mounted into the card's host
  // after the markup exists, and the previous one is torn down first so a
  // re-render never leaves a loop running on a detached node. The card is
  // then scrolled into view — the sheet was rebuilt from the top, and the
  // row the user tapped may be far down a list of fifty.
  preview?.destroy();
  preview = null;
  const host = main.querySelector<HTMLElement>('#plPreviewDemo');
  if (host && picked !== null) {
    const ex = libraryExercises(doc).find((e) => e.id === picked);
    preview = mountExerciseDemo(host, picked, { label: tr(W).demo.labelOf(ex ? exName(ex) : '') });
  }
  const card = main.querySelector<HTMLElement>('.pl-preview');
  if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });

  bind(main, deps);
}

function hintText(dirty: boolean, stored: PlanDoc | null): string {
  const E = tr(P).editor;
  if (dirty) return E.dirty;
  return isDefaultPlan(stored) ? E.original : E.saved;
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
      picked = null;
      weekdayHint = '';
      refresh();
    });
  });

  /* ---------------------------------------------------- day management --- */
  main.querySelector<HTMLButtonElement>('#plDayAdd')?.addEventListener('click', () => {
    if (doc.days.length >= PLAN_LIMITS.maxDays) {
      toast(tr(P).days.maxToast(PLAN_LIMITS.maxDays));
      return;
    }
    const key = newDayKey();
    leavingMap(doc, () => doc.days.push(makePlanDay(key, newDayLabel(), [], [])));
    doc.weeklyTarget = deriveWeeklyTarget(doc.days);
    activeDay = key;
    weekdayHint = '';
    // A day with no exercises cannot be saved, so the library opens immediately:
    // adding a day and choosing its first exercise is ONE gesture, not two.
    sheet = 'library';
    picked = null;
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
    if (tab) tab.textContent = dayLabel(day);
    markDirty(main, deps);
  });
  nameInput?.addEventListener('change', () => {
    const day = activeDayOf(doc);
    if (!day.label.trim()) {
      day.label = newDayLabel();
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
      toast(tr(P).days.minToast);
      return;
    }
    const day = activeDayOf(doc);
    const label = dayLabel(day);
    if (!confirm(tr(P).days.removeConfirm(label))) {
      return;
    }
    leavingMap(doc, () => {
      doc.days = doc.days.filter((d) => d.key !== day.key);
    });
    doc.weeklyTarget = deriveWeeklyTarget(doc.days);
    activeDay = doc.days[0]?.key ?? '';
    weekdayHint = '';
    toast(tr(P).days.removed(label));
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
        syncPair(main, doc, row, field);
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
        // a cardio ladder may have more stages than a lift has sets
        const hi = field === 'sets' ? maxSetsOf(makeResolver(doc)(id)) : PLAN_LIMITS.maxRest;
        const n = Number.parseInt(inp.value, 10);
        const fallback = field === 'sets' ? NEW_ROW_DEFAULTS.sets : NEW_ROW_DEFAULTS.rest;
        row[field] = Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : fallback));
        inp.value = String(row[field]);
        syncPair(main, doc, row, field);
      }
      markDirty(main, deps);
    });
  });

  /* ------------------------------------------------- superset link / unlink */
  main.querySelectorAll<HTMLButtonElement>('[data-sslink]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      linkSuperset(doc, b.dataset['sslink'] ?? '');
      refresh();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-ssunlink]').forEach((b) => {
    b.addEventListener('click', () => {
      unlinkSuperset(doc, b.dataset['ssunlink'] ?? '');
      refresh();
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
        toast(tr(P).row.minToast);
        return;
      }
      if (!confirm(tr(P).row.removeConfirm(def ? exName(def) : id, activeLabel(doc)))) return;
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
      // A removed row takes its superset with it — the other half stays, alone.
      setPairs(activeDayOf(doc), supersetPairs(activeDayOf(doc)));
      refresh();
    });
  });

  /* ------------------------------------------------------- the add sheet -- */
  main.querySelector<HTMLButtonElement>('#plAdd')?.addEventListener('click', () => {
    sheet = 'library';
    picked = null;
    refresh();
  });
  main.querySelector<HTMLButtonElement>('#plSheetClose')?.addEventListener('click', () => {
    sheet = 'closed';
    picked = null;
    refresh();
  });
  main.querySelector<HTMLElement>('#plBackdrop')?.addEventListener('click', () => {
    sheet = 'closed';
    picked = null;
    refresh();
  });
  main.querySelector<HTMLButtonElement>('#plNewToggle')?.addEventListener('click', () => {
    sheet = 'new';
    picked = null;
    refresh();
  });

  /* ------------------------------------------------- the preview card ---- */
  // a tap on a name OPENS it (a second tap closes it); nothing is added until
  // the card's own ➕ is pressed
  main.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset['pick'];
      if (!id) return;
      picked = picked === id ? null : id;
      refresh();
    });
  });
  main.querySelector<HTMLButtonElement>('[data-unpick]')?.addEventListener('click', () => {
    picked = null;
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
      if (!confirm(tr(P).presets.replaceConfirm(preset.name))) return;
      draft = clonePlanDoc(preset.build());
      activeDay = draft.days[0]?.key ?? '';
      sheet = 'closed';
      weekdayHint = '';
      toast(tr(P).presets.loaded(preset.name));
      refresh();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-user-preset]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset['userPreset'] ?? '';
      const preset = deps.store.getState().planPresets[id];
      if (!preset) return;
      // Same contract as a built-in preset: replace the DRAFT after a confirm,
      // with fresh day keys minted per application (see `instantiateUserPreset`).
      if (!confirm(tr(P).presets.replaceConfirm(preset.name))) return;
      draft = instantiateUserPreset(preset);
      activeDay = draft.days[0]?.key ?? '';
      sheet = 'closed';
      weekdayHint = '';
      toast(tr(P).presets.loaded(preset.name));
      refresh();
    });
  });
  main.querySelector<HTMLButtonElement>('#plSavePreset')?.addEventListener('click', () => {
    // Freezes the DRAFT — exactly what the user is looking at, saved or not.
    const name = prompt(tr(P).presets.namePrompt, tr(P).presets.nameDefault);
    if (name === null) return;
    const res = saveUserPreset(deps.store, name, doc);
    if (!res.ok) {
      toast(res.error);
      return;
    }
    toast(tr(P).presets.saved(res.preset.name));
    refresh(); // the sheet stays open, so the new card is right there
  });
  main.querySelectorAll<HTMLButtonElement>('[data-preset-del]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset['presetDel'] ?? '';
      const preset = deps.store.getState().planPresets[id];
      if (!preset) return;
      if (!confirm(tr(P).presets.deleteConfirm(preset.name))) return;
      deleteUserPreset(deps.store, id);
      toast(tr(P).presets.deleted(preset.name));
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
      picked = null;
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
      toast(res.errors[0] ?? tr(P).validate.invalid);
      return;
    }
    draft = clonePlanDoc(res.plan ?? defaultPlanDoc());
    toast(tr(P).editor.savedToast);
    refresh();
  });

  main.querySelector<HTMLButtonElement>('#plReset')?.addEventListener('click', () => {
    if (!confirm(tr(P).editor.resetConfirm)) {
      return;
    }
    // `null` means "the built-in program" — except for a user who went through
    // onboarding, for whom no plan is the EMPTY plan (core/profile.ts
    // needsPlanChoice). They get the original program as a document instead.
    savePlan(deps.store, deps.store.getState().profile !== null ? defaultPlanDoc() : null);
    draft = clonePlanDoc(defaultPlanDoc());
    sheet = 'closed';
    toast(tr(P).editor.resetToast);
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

/**
 * Run a mutation that may take the draft OUT of the built-in routing map, and
 * when it does, collapse the A/B/C ranges to the single weekdays that name
 * them (`collapseRoutingRanges`) — so a fourth day never turns the built-in
 * three into seven tabs. Once the draft is a real schedule, nothing is touched.
 */
function leavingMap(doc: PlanDoc, mutate: () => void): void {
  const wasMap = isBuiltInWeekdayMap(doc.days);
  mutate();
  if (wasMap && !isBuiltInWeekdayMap(doc.days)) collapseRoutingRanges(doc.days);
}

/** Move the active day in the array — that array IS the tab order. */
function moveDay(doc: PlanDoc, delta: number): void {
  const idx = doc.days.findIndex((d) => d.key === activeDay);
  const next = idx + delta;
  if (idx < 0 || next < 0 || next >= doc.days.length) return;
  const a = doc.days[idx];
  const b = doc.days[next];
  if (!a || !b) return;
  leavingMap(doc, () => {
    doc.days[idx] = b;
    doc.days[next] = a;
  });
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
  weekdayHint = '';
  // The first tap on the built-in map LEAVES it: the ranges collapse to the
  // single weekdays that name them before the tap is applied. A tap that
  // switched off a weekday the collapse just dropped (Monday on A) is thereby
  // done; any other tap goes on to act on the collapsed schedule.
  if (isBuiltInWeekdayMap(doc.days)) {
    const wasOn = (day.weekdays ?? []).includes(wd);
    collapseRoutingRanges(doc.days);
    if (wasOn && !(day.weekdays ?? []).includes(wd)) return;
  }
  const current = day.weekdays ?? [];
  if (current.includes(wd)) {
    day.weekdays = current.filter((w) => w !== wd);
  } else {
    const owner = doc.days.find((d) => d.key !== day.key && (d.weekdays ?? []).includes(wd));
    if (owner) {
      owner.weekdays = (owner.weekdays ?? []).filter((w) => w !== wd);
      if (owner.weekdays.length === 0) delete owner.weekdays;
      weekdayHint = tr(P).days.moved(weekdayName(wd), dayLabel(owner));
    }
    day.weekdays = [...current, wd].sort((a, b) => a - b);
  }
  // An empty list is stored as NO field at all, exactly like `makePlanDay` does,
  // so a document compares equal to itself after a save round trip.
  if ((day.weekdays ?? []).length === 0) delete day.weekdays;
  // …and the key ORDER has to match `makePlanDay`'s too (weekdays, then
  // supersets), because `planIsDirty` compares documents by their JSON: a
  // weekday switched off and on again must not look like an unsaved change.
  const pairs = day.supersets;
  if (pairs) {
    delete day.supersets;
    day.supersets = pairs;
  }
  doc.weeklyTarget = deriveWeeklyTarget(doc.days);
}

function move(doc: PlanDoc, id: string, delta: number): void {
  const day = activeDayOf(doc);
  const rows = day.exercises;
  const idx = rows.findIndex((r) => r.id === id);
  const next = idx + delta;
  if (idx < 0 || next < 0 || next >= rows.length) return;
  const a = rows[idx];
  const b = rows[next];
  if (!a || !b) return;
  rows[idx] = b;
  rows[next] = a;
  // Swapping the two halves of a superset keeps the superset — they are still
  // next to each other, the user merely chose to do the other one first — so
  // the pair is rewritten in the new order instead of being torn up. Every
  // OTHER move pulls a row out of adjacency, and `setPairs` drops the link.
  setPairs(
    day,
    supersetPairs(day).map((p) => (p[0] === a.id && p[1] === b.id ? ([b.id, a.id] as SupersetPair) : p)),
  );
}

/* ------------------------------------------------------------- supersets */

/**
 * Write the day's pairs back, keeping them LEGAL (both ids present, adjacent,
 * each exercise in at most one pair) and in the day's own order.
 *
 * Every structural edit routes through here, which is what makes "a move or a
 * removal that separates a pair breaks the link" a property of the draft rather
 * than a rule each button has to remember. An empty list is stored as no field
 * at all, so a day without supersets serialises exactly as it did before this
 * feature existed.
 */
function setPairs(day: PlanDay, pairs: readonly SupersetPair[]): void {
  const index = new Map(day.exercises.map((r, i) => [r.id, i] as const));
  const legal = legalPairs(pairs, day.exercises).sort(
    (p, q) => (index.get(p[0]) ?? 0) - (index.get(q[0]) ?? 0),
  );
  if (legal.length > 0) day.supersets = legal;
  else delete day.supersets;
}

/**
 * Link a row to the one BELOW it, and make the two numbers a superset shares
 * agree at once: one rest (the first row's — it is the rest of the pair) and
 * the larger of the two set counts, so neither exercise silently loses a set.
 * Reps stay independent; a superset is two different exercises.
 */
function linkSuperset(doc: PlanDoc, id: string): void {
  const day = activeDayOf(doc);
  const rows = day.exercises;
  const idx = rows.findIndex((r) => r.id === id);
  const a = rows[idx];
  const b = rows[idx + 1];
  if (!a || !b) return;
  if (isSuperset(day, a.id) || isSuperset(day, b.id)) return;
  const sets = Math.max(a.sets, b.sets);
  a.sets = sets;
  b.sets = sets;
  b.rest = a.rest;
  setPairs(day, [...supersetPairs(day), [a.id, b.id]]);
}

/** Break the pair that starts at `id` — the rows and their numbers stay put. */
function unlinkSuperset(doc: PlanDoc, id: string): void {
  const day = activeDayOf(doc);
  setPairs(day, supersetPairs(day).filter((p) => p[0] !== id));
}

/**
 * Mirror a shared number onto the partner row — draft AND input, without a
 * re-render, exactly like every other inline edit here (a re-render would steal
 * the caret mid-number).
 */
function syncPair(main: HTMLElement, doc: PlanDoc, row: PlanExercise, field: 'sets' | 'rest'): void {
  const day = activeDayOf(doc);
  const partnerId = supersetPartner(day, row.id);
  if (!partnerId) return;
  const partner = day.exercises.find((r) => r.id === partnerId);
  if (!partner) return;
  partner[field] = row[field];
  const el = main.querySelector<HTMLInputElement>(`[data-edit="${field}"][data-id="${partnerId}"]`);
  if (el) el.value = String(partner[field]);
}

function addRow(doc: PlanDoc, id: string): void {
  const rows = rowsOf(doc, activeDay);
  if (rows.some((r) => r.id === id)) return;
  if (rows.length >= PLAN_LIMITS.maxExercisesPerDay) {
    toast(tr(P).row.maxToast(PLAN_LIMITS.maxExercisesPerDay));
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

  // In English the first field is the reader's own name for it (stored as `en`,
  // and as the required `he` unless a Hebrew one is given) — see newExerciseForm.
  const en = locale() === 'en';
  const first = val('nxHe').trim();
  const second = val('nxEn').trim();
  const he = en ? second || first : first;
  if (!first) {
    toast(tr(P).form.nameMissing);
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
    en: (en ? first : second).slice(0, PLAN_LIMITS.maxNameLength),
    bodyPart,
    unit,
    equip: equip.length > 0 ? equip : ['Bodyweight'],
    // stored in the program's own word (data); `exMuscle` shows it in the reader's
    muscle: BODY_PART_HE[bodyPart],
  };
  // A secondary part is stored as the same 70/30 split the built-in compound
  // lifts use, so custom exercises feed the character exactly like real ones.
  if (secondary) custom.split = { [bodyPart]: 0.7, [secondary]: 0.3 };

  doc.customExercises.push(custom);
  addRow(doc, custom.id);
  sheet = 'closed';
  toast(tr(P).form.added(exName(customToExercise(custom)), activeLabel(doc)));
  refresh();
}
