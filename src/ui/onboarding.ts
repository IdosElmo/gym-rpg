/**
 * ui/onboarding.ts — the opening questionnaire, full screen.
 *
 * WHO SEES IT. A fresh install (`needsOnboarding`, core/profile.ts) — the shell
 * mounts it instead of the app when `main.ts` asked for it (`hooks.onboarding`)
 * — and anybody who re-opens it from the 👤 card on הגדרות, in an EDIT mode.
 * Nobody with history is ever stopped by it.
 *
 * NINE SCREENS. 0 welcome (language + units, "let's start" / skip-all), then
 * eight questions with a progress bar: 1 about you, 2 body, 3 goal*, 4
 * experience, 5 schedule*, 6 location*, 7 activity & injuries, 8 summary
 * (targets + plan). The starred ones are required — their CTA stays disabled
 * until they are answered; every other one offers "דלג", which clears that
 * screen's answers and moves on.
 *
 * THE ANSWERS LIVE HERE, in module state, until the last tap — then
 * `finishOnboarding` (core/onboarding.ts) appends the events, in one go. A
 * reload half-way through simply starts over: nothing was written.
 *
 * Inputs never re-render the screen (that would steal focus mid-number): they
 * write into the draft and refresh the footer's CTA and the error lines in
 * place. Taps on a card or chip DO re-render — the DOM has to change then.
 *
 * Numbers are entered in the user's units and stored metric: weights through
 * `displayToKg`, an imperial height as feet + inches through `ftInToCm`.
 */

import {
  ACTIVITIES,
  EXPERIENCES,
  GOALS,
  INJURIES,
  LOCATIONS,
  PROFILE_LIMITS,
  SESSION_MINUTES,
  recommendPreset,
  targetsForProfile,
  type Activity,
  type Experience,
  type Goal,
  type Injury,
  type Location,
  type Profile,
  type Sex,
  type Targets,
} from '../core/profile.ts';
import { finishOnboarding, profileOf, skipOnboarding, type OnboardingAnswers, type PlanChoice } from '../core/onboarding.ts';
import { WEIGHT_MAX_KG, WEIGHT_MIN_KG, weightEntries } from '../core/weight.ts';
import { todayISO } from '../core/workout.ts';
import { ALL_PRESETS, presetById } from '../data/presets.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { LOCALES, LOCALE_NATIVE_NAME, isLocale, locale, tr } from '../i18n/locale.ts';
import { CM_PER_IN, UNIT_SYSTEMS, displayToKg, fmtHeight, ftInToCm, isUnitSystem, kgToDisplay, units, weightUnit } from '../i18n/units.ts';
import { fmtNum, weekStartDay, weekdayName, weekdayOrder, weekdayShort } from '../i18n/format.ts';
import { onboarding as O } from '../i18n/messages/onboarding.ts';
import { esc } from './dom.ts';
import { icon, type IconName } from './icons.ts';

export type OnboardingMode = 'onboard' | 'edit';

/** How a questionnaire session ended — what the shell does next depends on it. */
export type OnboardingOutcome =
  | { kind: 'skipped' }
  | { kind: 'cancelled'; mode: OnboardingMode }
  | { kind: 'finished'; mode: OnboardingMode; name: string };

export interface OnboardingDeps {
  store: DataStore;
  /** A full app render (a language switch re-renders everything). */
  rerender: () => void;
  /** The session is over; the shell closes it and decides where to land. */
  done: (outcome: OnboardingOutcome) => void;
}

/** The eight question screens after the welcome. */
export const QUESTION_COUNT = 8;
const STEP = { welcome: 0, about: 1, body: 2, goal: 3, experience: 4, schedule: 5, location: 6, activity: 7, summary: 8 } as const;

/** Days-per-week chips. */
const DAY_CHOICES = [2, 3, 4, 5, 6] as const;

/**
 * A sensible spread of `n` training days, rest days between where they fit —
 * from the week's first day as the reader draws it (Sunday in Hebrew, Monday
 * in English), the same convention as the weekday pickers.
 */
export function weekdaySpread(n: number, weekStart: number): number[] {
  const offsets: Record<number, number[]> = {
    1: [0],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return (offsets[n] ?? []).map((o) => (o + weekStart) % 7).sort((a, b) => a - b);
}

interface BodyText {
  age: string;
  height: string;
  ft: string;
  inch: string;
  weight: string;
  goal: string;
}

interface Draft {
  mode: OnboardingMode;
  step: number;
  name: string;
  sex: Sex | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  goalKg: number | null;
  /** What the body inputs say right now, in the display units. */
  text: BodyText;
  goal: Goal | null;
  goalNote: string;
  experience: Experience | null;
  days: number | null;
  weekdays: number[];
  minutes: number | null;
  location: Location | null;
  activity: Activity | null;
  injuries: Injury[];
  /** Typed targets; `null` = still the recommendation. */
  calText: string | null;
  proText: string | null;
  /** Edit mode: save the targets too (the onboarding mode always does). */
  updateTargets: boolean;
  /** The plan the user picked on the summary; `null` = the default. */
  plan: PlanChoice | null;
  planOpen: boolean;
  /** The store already has a plan (or history on the built-in one): "keep" is offered and is the default. */
  hasPlan: boolean;
}

let session: Draft | null = null;

export function isOnboardingOpen(): boolean {
  return session !== null;
}

export function closeOnboarding(): void {
  session = null;
}

/** The current step (tests and the shell's scroll handling). */
export function onboardingStep(): number {
  return session?.step ?? -1;
}

/**
 * Open a session. The onboarding mode starts empty; the edit mode starts from
 * what the store says (the profile, the latest weigh-in, the goal weight).
 */
export function openOnboarding(store: DataStore, mode: OnboardingMode, year: number = new Date().getFullYear()): void {
  const state = store.getState();
  const p: Profile = mode === 'edit' ? (state.profile ?? {}) : {};
  const latest = weightEntries(state.nutrition).at(-1) ?? null;
  session = {
    mode,
    step: STEP.welcome,
    name: p.name ?? '',
    sex: p.sex ?? null,
    age: p.birthYear !== undefined ? year - p.birthYear : null,
    heightCm: p.heightCm ?? null,
    weightKg: mode === 'edit' ? (latest?.kg ?? null) : null,
    goalKg: mode === 'edit' ? state.nutrition.weightTarget : null,
    text: { age: '', height: '', ft: '', inch: '', weight: '', goal: '' },
    goal: p.goal ?? null,
    goalNote: p.goalNote ?? '',
    experience: p.experience ?? null,
    days: p.daysPerWeek ?? p.weekdays?.length ?? null,
    weekdays: [...(p.weekdays ?? [])],
    minutes: p.sessionMinutes ?? null,
    location: p.location ?? null,
    activity: p.activity ?? null,
    injuries: [...(p.injuries ?? [])],
    calText: null,
    proText: null,
    updateTargets: false,
    plan: null,
    planOpen: false,
    hasPlan: mode === 'edit' && (state.plan !== null || Object.keys(state.sessions).length > 0),
  };
}

/* ------------------------------------------------------------ the numbers */

/** `''` → null, a number → itself, anything else → NaN (an error to show). */
function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Fill the body inputs' text from the stored (metric) answers, in today's units. */
function syncBodyText(d: Draft): void {
  const w = (kg: number | null): string => (kg === null ? '' : String(round1(kgToDisplay(kg))));
  d.text.age = d.age === null ? '' : String(d.age);
  d.text.weight = w(d.weightKg);
  d.text.goal = w(d.goalKg);
  if (d.heightCm === null) {
    d.text.height = d.text.ft = d.text.inch = '';
  } else {
    d.text.height = String(Math.round(d.heightCm));
    const totalIn = Math.round(d.heightCm / CM_PER_IN);
    d.text.ft = String(Math.floor(totalIn / 12));
    d.text.inch = String(totalIn % 12);
  }
}

interface BodyErrors {
  age: string;
  height: string;
  weight: string;
  goal: string;
}

/** Read the body inputs' text into the draft; returns the error line of each field. */
function readBody(d: Draft): BodyErrors {
  const E = tr(O).body.err;
  const err: BodyErrors = { age: '', height: '', weight: '', goal: '' };

  const age = parseNum(d.text.age);
  const ageOk = age !== null && Number.isInteger(age) && age >= PROFILE_LIMITS.minAge && age <= PROFILE_LIMITS.maxAge;
  d.age = ageOk ? age : null;
  if (age !== null && !ageOk) err.age = E.age(PROFILE_LIMITS.minAge, PROFILE_LIMITS.maxAge);

  let cm: number | null;
  if (units() === 'imperial') {
    const ft = parseNum(d.text.ft);
    const inch = parseNum(d.text.inch);
    cm = ft === null && inch === null ? null : ftInToCm(ft ?? 0, inch ?? 0);
  } else {
    cm = parseNum(d.text.height);
  }
  const hOk = cm !== null && cm >= PROFILE_LIMITS.minHeightCm && cm <= PROFILE_LIMITS.maxHeightCm;
  d.heightCm = hOk ? Math.round(cm ?? 0) : null;
  if (cm !== null && !hOk) err.height = E.height(fmtHeight(PROFILE_LIMITS.minHeightCm), fmtHeight(PROFILE_LIMITS.maxHeightCm));

  const wBounds = (): [string, string] => [
    `${fmtNum(Math.ceil(kgToDisplay(WEIGHT_MIN_KG)))} ${weightUnit()}`,
    `${fmtNum(Math.floor(kgToDisplay(WEIGHT_MAX_KG)))} ${weightUnit()}`,
  ];
  const kgOf = (s: string): number | null => {
    const v = parseNum(s);
    if (v === null) return null;
    if (Number.isNaN(v)) return NaN;
    return Math.round(displayToKg(v) * 100) / 100;
  };
  const inRange = (kg: number | null): boolean => kg !== null && kg >= WEIGHT_MIN_KG && kg <= WEIGHT_MAX_KG;
  const w = kgOf(d.text.weight);
  d.weightKg = inRange(w) ? w : null;
  if (w !== null && !inRange(w)) err.weight = E.weight(...wBounds());
  const g = kgOf(d.text.goal);
  d.goalKg = inRange(g) ? g : null;
  if (g !== null && !inRange(g)) err.goal = E.weight(...wBounds());
  return err;
}

/** The profile the draft describes (age resolved against this year). */
function profileDraft(d: Draft): Profile {
  const p: Profile = {};
  if (d.name.trim()) p.name = d.name;
  if (d.sex) p.sex = d.sex;
  if (d.heightCm !== null) p.heightCm = d.heightCm;
  if (d.goal) p.goal = d.goal;
  if (d.goal === 'other' && d.goalNote.trim()) p.goalNote = d.goalNote;
  if (d.experience) p.experience = d.experience;
  if (d.days !== null) p.daysPerWeek = d.days;
  if (d.weekdays.length > 0) p.weekdays = [...d.weekdays].sort((a, b) => a - b);
  if (d.location) p.location = d.location;
  if (d.activity) p.activity = d.activity;
  if (d.minutes !== null) p.sessionMinutes = d.minutes;
  if (d.injuries.length > 0) p.injuries = [...d.injuries];
  return p;
}

function answersOf(d: Draft): OnboardingAnswers {
  return { profile: profileDraft(d), age: d.age, weightKg: d.weightKg, goalWeightKg: d.goalKg };
}

function recommendationOf(d: Draft, year: number): Targets | null {
  return targetsForProfile(profileOf(answersOf(d), year), d.weightKg, year);
}

/** A typed target: a whole non-negative number, or `null` for an empty box. */
function targetNum(text: string | null, fallback: number): number | null {
  if (text === null) return fallback;
  const v = parseNum(text);
  if (v === null || Number.isNaN(v) || v < 0) return null;
  return Math.round(v);
}

const PRESET_IDS = (): string[] => ALL_PRESETS.map((p) => p.id);

/** The plan the summary shows when the user has not picked one. */
function defaultPlan(d: Draft): PlanChoice {
  if (d.hasPlan) return 'keep';
  return { preset: recommendPreset(profileDraft(d), PRESET_IDS()).id };
}

function planOf(d: Draft): PlanChoice {
  return d.plan ?? defaultPlan(d);
}

const sameChoice = (a: PlanChoice, b: PlanChoice): boolean =>
  typeof a === 'object' && typeof b === 'object' ? a.preset === b.preset : a === b;

/* ------------------------------------------------------------- the rules */

function canContinue(d: Draft): boolean {
  switch (d.step) {
    case STEP.body: {
      const e = readBody(d);
      return !e.age && !e.height && !e.weight && !e.goal;
    }
    case STEP.goal:
      return d.goal !== null;
    case STEP.schedule:
      return d.days !== null && d.weekdays.length === d.days;
    case STEP.location:
      return d.location !== null;
    default:
      return true;
  }
}

function skippable(step: number): boolean {
  return step === STEP.about || step === STEP.body || step === STEP.experience || step === STEP.activity;
}

/** "דלג" on a question: forget that screen's answers. */
function clearStep(d: Draft): void {
  switch (d.step) {
    case STEP.about:
      d.name = '';
      d.sex = null;
      break;
    case STEP.body:
      d.age = d.heightCm = d.weightKg = d.goalKg = null;
      d.text = { age: '', height: '', ft: '', inch: '', weight: '', goal: '' };
      break;
    case STEP.experience:
      d.experience = null;
      break;
    case STEP.activity:
      d.activity = null;
      d.injuries = [];
      break;
  }
}

/* ---------------------------------------------------------------- markup */

function card(group: string, value: string, ic: IconName, title: string, desc: string, on: boolean): string {
  return `<button type="button" class="onb-opt${on ? ' sel' : ''}" role="radio" aria-checked="${on}" data-pick="${group}" data-val="${esc(value)}">
    <span class="onb-oic">${icon(ic)}</span>
    <span class="onb-tx"><b>${esc(title)}</b><small>${esc(desc)}</small></span>
    <span class="onb-radio" aria-hidden="true"></span>
  </button>`;
}

function cards<T extends string>(
  group: string,
  label: string,
  values: readonly T[],
  icons: Record<T, IconName>,
  copy: Record<T, { title: string; desc: string }>,
  current: T | null,
): string {
  return `<div class="onb-opts" role="radiogroup" aria-label="${esc(label)}">${values
    .map((v) => card(group, v, icons[v], copy[v].title, copy[v].desc, v === current))
    .join('')}</div>`;
}

function chip(group: string, value: string | number, label: string, on: boolean, aria = ''): string {
  return `<button type="button" class="onb-chip${on ? ' on' : ''}" aria-pressed="${on}" data-chip="${group}" data-val="${value}"${
    aria ? ` aria-label="${esc(aria)}"` : ''
  }>${esc(label)}</button>`;
}

function head(title: string, sub: string): string {
  return `<h1 class="onb-q" id="onbTitle" tabindex="-1">${esc(title)}</h1>${sub ? `<p class="onb-sub">${esc(sub)}</p>` : ''}`;
}

function numInput(id: string, value: string, unit: string, label: string, mode: 'numeric' | 'decimal' = 'decimal'): string {
  return `<span class="onb-input"><input id="${id}" type="text" inputmode="${mode}" autocomplete="off" value="${esc(value)}" aria-label="${esc(label)}"><span class="onb-unit">${esc(unit)}</span></span>`;
}

function field(label: string, inputs: string, errId: string, optional = false): string {
  const C = tr(O).common;
  return `<div class="onb-field">
    <span class="onb-label">${esc(label)}${optional ? ` <small>(${esc(C.optional)})</small>` : ''}</span>
    <div class="onb-inputs">${inputs}</div>
    <span class="onb-err" id="${errId}" role="alert"></span>
  </div>`;
}

function welcomeStep(d: Draft): string {
  const W = tr(O).welcome;
  const seg = (attr: string, value: string, label: string, on: boolean, lang?: string): string =>
    `<button type="button" class="seg-btn${on ? ' active' : ''}" data-${attr}="${value}" aria-pressed="${on}"${
      lang ? ` lang="${lang}"` : ''
    }>${esc(label)}</button>`;
  return `<div class="onb-hero">
      <span class="onb-logo">${icon('dumbbell')}</span>
      <h1 class="onb-app" id="onbTitle" tabindex="-1">${esc(W.appName)}</h1>
      <p class="onb-tagline">${esc(W.tagline)}</p>
      <p class="onb-sub">${esc(d.mode === 'edit' ? W.editIntro : W.intro)}</p>
    </div>
    <section class="onb-card onb-prefs">
      <div class="onb-prefs-row">
        <span class="onb-label">${icon('globe')}${esc(W.language)}</span>
        <div class="seg" role="group" aria-label="${esc(W.language)}">${LOCALES.map((l) =>
          seg('locale', l, LOCALE_NATIVE_NAME[l], l === locale(), l),
        ).join('')}</div>
      </div>
      <div class="onb-prefs-row">
        <span class="onb-label">${icon('scale')}${esc(W.units)}</span>
        <div class="seg" role="group" aria-label="${esc(W.units)}">${UNIT_SYSTEMS.map((u) =>
          seg('units', u, W.unitNames[u], u === units()),
        ).join('')}</div>
      </div>
    </section>`;
}

function aboutStep(d: Draft): string {
  const A = tr(O).about;
  return `${head(A.title, A.sub)}
    <div class="onb-field">
      <label class="onb-label" for="onbName">${esc(A.name)} <small>(${esc(tr(O).common.optional)})</small></label>
      <input class="onb-text" id="onbName" type="text" maxlength="${PROFILE_LIMITS.nameMax}" autocomplete="given-name"
        placeholder="${esc(A.namePlaceholder)}" value="${esc(d.name)}">
    </div>
    ${cards('sex', A.sexLabel, ['male', 'female', 'other'] as const, { male: 'male', female: 'female', other: 'user' }, A.sex, d.sex)}`;
}

function bodyStep(d: Draft): string {
  const B = tr(O).body;
  const height =
    units() === 'imperial'
      ? `${numInput('onbFt', d.text.ft, B.ft, `${B.height} (${B.ft})`, 'numeric')}${numInput('onbIn', d.text.inch, B.inch, `${B.height} (${B.inch})`, 'numeric')}`
      : numInput('onbHeight', d.text.height, B.cm, B.height, 'numeric');
  return `${head(B.title, B.sub)}
    <div class="onb-grid">
      ${field(B.age, numInput('onbAge', d.text.age, B.years, B.age, 'numeric'), 'onbAgeErr')}
      ${field(B.height, height, 'onbHeightErr')}
      ${field(B.weight, numInput('onbWeight', d.text.weight, weightUnit(), B.weight), 'onbWeightErr')}
      ${field(B.goalWeight, numInput('onbGoalW', d.text.goal, weightUnit(), B.goalWeight), 'onbGoalErr', true)}
    </div>`;
}

const GOAL_ICONS: Record<Goal, IconName> = {
  lose_fat: 'flame',
  build_muscle: 'dumbbell',
  recomp: 'target',
  strength: 'bolt',
  general: 'heart',
  other: 'dots',
};

function goalStep(d: Draft): string {
  const G = tr(O).goal;
  const note =
    d.goal === 'other'
      ? `<div class="onb-field">
      <label class="onb-label" for="onbGoalNote">${esc(G.note)}</label>
      <input class="onb-text" id="onbGoalNote" type="text" maxlength="${PROFILE_LIMITS.goalNoteMax}" autocomplete="off"
        placeholder="${esc(G.notePlaceholder)}" value="${esc(d.goalNote)}">
    </div>`
      : '';
  return `${head(G.title, G.sub)}${cards('goal', G.title, GOALS, GOAL_ICONS, G.options, d.goal)}${note}`;
}

function experienceStep(d: Draft): string {
  const X = tr(O).experience;
  return `${head(X.title, X.sub)}${cards(
    'experience',
    X.title,
    EXPERIENCES,
    { beginner: 'sprout', intermediate: 'trend', advanced: 'trophy' },
    X.options,
    d.experience,
  )}`;
}

/** The weekdays in display order, as "ראשון · שלישי · חמישי". */
function weekdaysText(days: readonly number[]): string {
  const set = new Set(days);
  return weekdayOrder()
    .filter((wd) => set.has(wd))
    .map((wd) => weekdayName(wd))
    .join(' · ');
}

function scheduleStep(d: Draft): string {
  const S = tr(O).schedule;
  const on = new Set(d.weekdays);
  const count =
    d.days === null
      ? ''
      : `<p class="onb-count-line${d.weekdays.length === d.days ? ' ok' : ''}" id="onbWdCount">${esc(
          d.weekdays.length === d.days ? S.pickedOk(d.days) : S.picked(d.weekdays.length, d.days),
        )}</p>`;
  return `${head(S.title, S.sub)}
    <section class="onb-card">
      <h2 class="onb-h">${icon('calendar')}${esc(S.days)}</h2>
      <div class="onb-chips onb-chips-fill" role="group" aria-label="${esc(S.days)}">${DAY_CHOICES.map((n) =>
        chip('days', n, String(n), d.days === n, S.daysOption(n)),
      ).join('')}</div>
      ${
        d.days === null
          ? ''
          : `<h2 class="onb-h">${esc(S.weekdays)}</h2>
      <div class="onb-chips onb-chips-fill onb-wds" role="group" aria-label="${esc(S.weekdays)}">${weekdayOrder()
        .map((wd) => chip('wd', wd, weekdayShort(wd), on.has(wd), weekdayName(wd)))
        .join('')}</div>${count}`
      }
    </section>
    <section class="onb-card">
      <h2 class="onb-h">${icon('clock')}${esc(S.session)} <small>(${esc(tr(O).common.optional)})</small></h2>
      <div class="onb-chips onb-chips-fill" role="group" aria-label="${esc(S.session)}">${SESSION_MINUTES.map((m) =>
        chip('minutes', m, S.minutes(m), d.minutes === m),
      ).join('')}</div>
    </section>`;
}

function locationStep(d: Draft): string {
  const L = tr(O).location;
  return `${head(L.title, L.sub)}${cards(
    'location',
    L.title,
    LOCATIONS,
    { gym: 'building', home_dumbbells: 'homeWeights', home_none: 'home' },
    L.options,
    d.location,
  )}`;
}

function activityStep(d: Draft): string {
  const A = tr(O).activity;
  const inj = new Set(d.injuries);
  return `${head(A.title, A.sub)}${cards(
    'activity',
    A.title,
    ACTIVITIES,
    { sedentary: 'sofa', light: 'walk', moderate: 'bike', active: 'run', very_active: 'hardhat' },
    A.options,
    d.activity,
  )}
    <section class="onb-card">
      <h2 class="onb-h">${esc(A.injuries)} <small>(${esc(tr(O).common.optional)})</small></h2>
      <div class="onb-chips" role="group" aria-label="${esc(A.injuries)}">${INJURIES.map((i) =>
        chip('injury', i, A.injuryNames[i], inj.has(i)),
      ).join('')}</div>
      <p class="onb-note">${esc(A.injuriesNote)}</p>
    </section>`;
}

function targetsCard(d: Draft, store: DataStore, year: number): string {
  const S = tr(O).summary;
  const rec = recommendationOf(d, year);
  const cur = store.getState().nutrition.targets;
  const current =
    d.mode === 'edit'
      ? `<p class="onb-note">${esc(
          S.current(cur.calories === null ? S.none : fmtNum(cur.calories), cur.protein === null ? S.none : fmtNum(cur.protein)),
        )}</p>`
      : '';
  if (!rec) {
    return `<section class="onb-card onb-targets">
      <h2 class="onb-h">${icon('target')}${esc(S.targets)}</h2>
      <p class="onb-note">${esc(S.noTargets)}</p>${current}
    </section>`;
  }
  const cal = d.calText ?? String(rec.calories);
  const pro = d.proText ?? String(rec.protein);
  const tick =
    d.mode === 'edit'
      ? `<label class="onb-check"><input type="checkbox" id="onbUpdTargets"${d.updateTargets ? ' checked' : ''}><span>${esc(S.updateTargets)}</span></label>`
      : '';
  return `<section class="onb-card onb-targets">
    <h2 class="onb-h">${icon('target')}${esc(S.targets)} <span class="onb-badge">${esc(S.recommendation)}</span></h2>
    <div class="onb-grid two">
      ${field(S.calories, numInput('onbCal', cal, S.kcal, S.calories, 'numeric'), 'onbCalErr')}
      ${field(S.protein, numInput('onbPro', pro, S.grams, S.protein, 'numeric'), 'onbProErr')}
    </div>
    <p class="onb-note">${esc(S.basis(fmtNum(rec.tdee)))}</p>${current}${tick}
  </section>`;
}

function planCard(d: Draft): string {
  const S = tr(O).summary;
  const choice = planOf(d);
  const rec = recommendPreset(profileDraft(d), PRESET_IDS());
  const days = d.weekdays.length > 0 ? `<p class="onb-plan-days">${icon('calendar')}${esc(S.weekdays(weekdaysText(d.weekdays)))}</p>` : '';
  const describe = (c: PlanChoice): { title: string; desc: string; preset: boolean; recommended: boolean } => {
    if (c === 'keep') return { ...S.keep, preset: false, recommended: false };
    if (c === 'empty') return { ...S.empty, preset: false, recommended: false };
    const p = presetById(c.preset);
    return { title: p?.name ?? c.preset, desc: p?.description ?? '', preset: true, recommended: c.preset === rec.id };
  };
  const shown = describe(choice);
  const options: PlanChoice[] = [
    ...(d.hasPlan ? (['keep'] as PlanChoice[]) : []),
    { preset: rec.id },
    ...rec.alternatives.map((id): PlanChoice => ({ preset: id })),
    ...(d.hasPlan ? [] : (['empty'] as PlanChoice[])),
  ];
  const list = d.planOpen
    ? `<div class="onb-opts onb-plan-list" role="radiogroup" aria-label="${esc(S.plan)}">${options
        .map((c) => {
          const m = describe(c);
          const val = typeof c === 'object' ? `preset:${c.preset}` : c;
          const title = m.recommended ? `${m.title} · ${S.recommended}` : m.title;
          return card('plan', val, m.preset ? 'dumbbell' : c === 'keep' ? 'check' : 'plus', title, m.desc, sameChoice(c, choice));
        })
        .join('')}</div>`
    : '';
  return `<section class="onb-card onb-plan">
    <h2 class="onb-h">${icon('dumbbell')}${esc(S.plan)}
      <button type="button" class="onb-link" id="onbPlanChange" aria-expanded="${d.planOpen}">${esc(d.planOpen ? S.changeDone : S.change)}</button>
    </h2>
    ${
      d.planOpen
        ? list
        : `<div class="onb-plan-main">
      <div class="onb-plan-title"><b class="onb-plan-name">${esc(shown.title)}</b>${
        shown.recommended ? `<span class="onb-badge">${esc(S.recommended)}</span>` : ''
      }</div>
      <p class="onb-note">${esc(shown.desc)}</p>
      ${shown.preset ? days : ''}
    </div>`
    }
  </section>`;
}

function summaryStep(d: Draft, store: DataStore, year: number): string {
  const S = tr(O).summary;
  return `${head(d.mode === 'edit' ? S.editTitle : S.title, S.sub)}${targetsCard(d, store, year)}${planCard(d)}`;
}

function stepBody(d: Draft, store: DataStore, year: number): string {
  switch (d.step) {
    case STEP.welcome:
      return welcomeStep(d);
    case STEP.about:
      return aboutStep(d);
    case STEP.body:
      return bodyStep(d);
    case STEP.goal:
      return goalStep(d);
    case STEP.experience:
      return experienceStep(d);
    case STEP.schedule:
      return scheduleStep(d);
    case STEP.location:
      return locationStep(d);
    case STEP.activity:
      return activityStep(d);
    default:
      return summaryStep(d, store, year);
  }
}

function topBar(d: Draft): string {
  if (d.step === STEP.welcome) return '';
  const C = tr(O).common;
  const pct = Math.round((d.step / QUESTION_COUNT) * 1000) / 10;
  return `<div class="onb-top">
    <button type="button" class="onb-icbtn" id="onbBack" aria-label="${esc(C.back)}">${icon('back')}</button>
    <div class="onb-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${QUESTION_COUNT}" aria-valuenow="${d.step}"
      aria-label="${esc(C.progress(d.step, QUESTION_COUNT))}"><i style="inline-size:${pct}%"></i></div>
    <span class="onb-step" dir="ltr">${d.step}/${QUESTION_COUNT}</span>
  </div>`;
}

function foot(d: Draft): string {
  const C = tr(O).common;
  const W = tr(O).welcome;
  const S = tr(O).summary;
  let cta = C.next;
  if (d.step === STEP.welcome) cta = d.mode === 'edit' ? C.next : W.start;
  if (d.step === STEP.summary) cta = d.mode === 'edit' ? S.save : S.finish;
  let second = '';
  if (d.step === STEP.welcome) {
    second =
      d.mode === 'edit'
        ? `<button type="button" class="onb-skip" id="onbCancel">${esc(C.cancel)}</button>`
        : `<button type="button" class="onb-skip" id="onbSkipAll">${esc(C.skip)}</button><p class="onb-hint">${esc(W.skipNote)}</p>`;
  } else if (skippable(d.step)) {
    second = `<button type="button" class="onb-skip" id="onbSkip">${esc(C.skip)}</button>`;
  }
  return `<div class="onb-foot">
    <button type="button" class="onb-cta" id="onbNext"${canContinue(d) ? '' : ' disabled'}>${esc(cta)}</button>
    ${second}
  </div>`;
}

/* ---------------------------------------------------------------- render */

export function renderOnboarding(root: HTMLElement, deps: OnboardingDeps): void {
  const d = session;
  if (!d) return;
  const year = new Date().getFullYear();
  root.setAttribute('data-step', String(d.step));
  root.setAttribute('data-mode', d.mode);
  root.innerHTML = `${topBar(d)}<div class="onb-body">${stepBody(d, deps.store, year)}</div>${foot(d)}`;
  if (d.step === STEP.body) showBodyErrors(root, d);
  bind(root, d, deps, year);
}

/** Refresh the CTA's enabled state without re-rendering (after an input). */
function refreshCta(root: HTMLElement, d: Draft): void {
  const btn = root.querySelector<HTMLButtonElement>('#onbNext');
  if (btn) btn.disabled = !canContinue(d);
}

function showBodyErrors(root: HTMLElement, d: Draft): void {
  const e = readBody(d);
  const set = (id: string, text: string): void => {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set('onbAgeErr', e.age);
  set('onbHeightErr', e.height);
  set('onbWeightErr', e.weight);
  set('onbGoalErr', e.goal);
}

function bind(root: HTMLElement, d: Draft, deps: OnboardingDeps, year: number): void {
  const { store } = deps;
  const rerender = (): void => renderOnboarding(root, deps);
  const go = (step: number): void => {
    d.step = Math.max(STEP.welcome, Math.min(STEP.summary, step));
    d.planOpen = false;
    if (d.step === STEP.body) syncBodyText(d);
    rerender();
    try {
      window.scrollTo(0, 0);
    } catch {
      /* non-browser host */
    }
    root.querySelector<HTMLElement>('#onbTitle')?.focus({ preventScroll: true });
  };

  /* ---- welcome: language + units, exactly like the settings prefs card ---- */
  root.querySelectorAll<HTMLButtonElement>('[data-locale]').forEach((b) => {
    b.addEventListener('click', () => {
      const l = b.dataset['locale'];
      if (!isLocale(l) || l === (store.getState().ui.locale ?? 'he')) return;
      store.update((s) => {
        s.ui.locale = l;
      });
      deps.rerender();
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-units]').forEach((b) => {
    b.addEventListener('click', () => {
      const u = b.dataset['units'];
      if (!isUnitSystem(u) || u === (store.getState().ui.units ?? 'metric')) return;
      store.update((s) => {
        s.ui.units = u;
      });
      deps.rerender();
    });
  });

  /* ---- navigation ---- */
  root.querySelector('#onbBack')?.addEventListener('click', () => go(d.step - 1));
  root.querySelector('#onbSkip')?.addEventListener('click', () => {
    clearStep(d);
    go(d.step + 1);
  });
  root.querySelector('#onbCancel')?.addEventListener('click', () => deps.done({ kind: 'cancelled', mode: d.mode }));
  root.querySelector('#onbSkipAll')?.addEventListener('click', () => {
    skipOnboarding(store, todayISO());
    deps.done({ kind: 'skipped' });
  });
  root.querySelector<HTMLButtonElement>('#onbNext')?.addEventListener('click', () => {
    if (!canContinue(d)) return;
    if (d.step < STEP.summary) {
      go(d.step + 1);
      return;
    }
    finish(d, deps, year);
  });

  /* ---- cards ---- */
  root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset['val'] ?? '';
      switch (b.dataset['pick']) {
        case 'sex':
          if (v === 'male' || v === 'female' || v === 'other') d.sex = v;
          break;
        case 'goal':
          d.goal = (GOALS as readonly string[]).includes(v) ? (v as Goal) : d.goal;
          break;
        case 'experience':
          d.experience = (EXPERIENCES as readonly string[]).includes(v) ? (v as Experience) : d.experience;
          break;
        case 'location':
          d.location = (LOCATIONS as readonly string[]).includes(v) ? (v as Location) : d.location;
          break;
        case 'activity':
          d.activity = (ACTIVITIES as readonly string[]).includes(v) ? (v as Activity) : d.activity;
          break;
        case 'plan':
          if (v === 'keep' || v === 'empty') d.plan = v;
          else if (v.startsWith('preset:')) d.plan = { preset: v.slice('preset:'.length) };
          d.planOpen = false;
          break;
      }
      rerender();
    });
  });

  /* ---- chips ---- */
  root.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number(b.dataset['val']);
      const v = b.dataset['val'] ?? '';
      switch (b.dataset['chip']) {
        case 'days':
          if (d.days !== n) {
            d.days = n;
            d.weekdays = weekdaySpread(n, weekStartDay());
          }
          break;
        case 'wd':
          d.weekdays = d.weekdays.includes(n) ? d.weekdays.filter((w) => w !== n) : [...d.weekdays, n].sort((a, b2) => a - b2);
          break;
        case 'minutes':
          d.minutes = d.minutes === n ? null : n;
          break;
        case 'injury':
          if ((INJURIES as readonly string[]).includes(v)) {
            const i = v as Injury;
            d.injuries = d.injuries.includes(i) ? d.injuries.filter((x) => x !== i) : [...d.injuries, i];
          }
          break;
      }
      rerender();
    });
  });

  /* ---- text inputs: into the draft, no re-render ---- */
  const onInput = (id: string, write: (value: string) => void): void => {
    root.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('input', (e) => {
      write((e.target as HTMLInputElement).value);
      if (d.step === STEP.body) showBodyErrors(root, d);
      refreshCta(root, d);
    });
  };
  onInput('onbName', (v) => (d.name = v));
  onInput('onbGoalNote', (v) => (d.goalNote = v));
  onInput('onbAge', (v) => (d.text.age = v));
  onInput('onbHeight', (v) => (d.text.height = v));
  onInput('onbFt', (v) => (d.text.ft = v));
  onInput('onbIn', (v) => (d.text.inch = v));
  onInput('onbWeight', (v) => (d.text.weight = v));
  onInput('onbGoalW', (v) => (d.text.goal = v));
  const tickTargets = (): void => {
    if (d.mode !== 'edit' || d.updateTargets) return;
    d.updateTargets = true;
    const box = root.querySelector<HTMLInputElement>('#onbUpdTargets');
    if (box) box.checked = true;
  };
  onInput('onbCal', (v) => {
    d.calText = v;
    tickTargets();
  });
  onInput('onbPro', (v) => {
    d.proText = v;
    tickTargets();
  });
  root.querySelector<HTMLInputElement>('#onbUpdTargets')?.addEventListener('change', (e) => {
    d.updateTargets = (e.target as HTMLInputElement).checked;
  });
  root.querySelector('#onbPlanChange')?.addEventListener('click', () => {
    d.planOpen = !d.planOpen;
    rerender();
  });
}

function finish(d: Draft, deps: OnboardingDeps, year: number): void {
  const now = new Date();
  const answers = answersOf(d);
  const rec = recommendationOf(d, year);
  if (rec && (d.mode === 'onboard' || d.updateTargets)) {
    answers.targets = { calories: targetNum(d.calText, rec.calories), protein: targetNum(d.proText, rec.protein) };
  }
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const profile = finishOnboarding(deps.store, answers, planOf(d), {
    date: todayISO(now),
    time: `${hh}:${mm}`,
    weightId: crypto.randomUUID(),
    year,
    now,
  });
  deps.done({ kind: 'finished', mode: d.mode, name: profile.name ?? '' });
}

/* ------------------------------------------------- the settings 👤 card */

/** One line per answered question, for the 👤 card on הגדרות. */
export function profileRows(profile: Profile, year: number): Array<[string, string]> {
  const M = tr(O);
  const R = M.settings.rows;
  const rows: Array<[string, string]> = [];
  if (profile.name) rows.push([R.name, profile.name]);
  if (profile.goal) {
    const g = M.goal.options[profile.goal].title;
    rows.push([R.goal, profile.goal === 'other' && profile.goalNote ? `${g} — ${profile.goalNote}` : g]);
  }
  if (profile.daysPerWeek !== undefined) {
    rows.push([R.days, M.settings.daysValue(profile.daysPerWeek, weekdaysText(profile.weekdays ?? []))]);
  }
  if (profile.location) rows.push([R.location, M.location.options[profile.location].title]);
  if (profile.experience) rows.push([R.experience, M.experience.options[profile.experience].title]);
  if (profile.activity) rows.push([R.activity, M.activity.options[profile.activity].title]);
  const body: string[] = [];
  if (profile.birthYear !== undefined) body.push(M.settings.ageValue(year - profile.birthYear));
  if (profile.heightCm !== undefined) body.push(fmtHeight(profile.heightCm));
  if (body.length > 0) rows.push([R.body, M.settings.bodyValue(body.join(' · '))]);
  return rows;
}
