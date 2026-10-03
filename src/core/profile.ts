/**
 * core/profile.ts — who the user is: the onboarding questionnaire's answers,
 * the calorie/protein targets they imply, and the plan they suggest.
 *
 * THE PROFILE IS DATA. It travels as ONE `profile_set` event carrying the whole
 * profile (last-writer-wins in the `(ts, id)` order, exactly like the plan), so
 * a second device of the same account folds the same answers. It grants
 * nothing: it is not part of `GameState`, and no reducer of the game reads it.
 * `AppState.profile` is the cache of that fold (`null` = never answered).
 *
 * The questionnaire does not own the numbers it produces. Weight, goal weight,
 * daily targets, the plan and the character's body each already have an event
 * of their own (`weight_logged`, `weight_target_set`, `nutrition_targets_set`,
 * `plan_updated`, `character_selected`), and finishing onboarding simply appends
 * those — so every screen that edits them later keeps working unchanged.
 *
 * Deterministic: the current year and date are parameters, never read here.
 */

import { PLAN_DOC_VERSION, type PlanDay, type PlanDoc } from '../data/planTypes.ts';
import type { AppEvent, AppState, DataStore } from '../storage/DataStore.ts';
import { deriveWeeklyTarget } from './plan.ts';

export type Sex = 'male' | 'female' | 'other';
export type Goal = 'lose_fat' | 'build_muscle' | 'recomp' | 'strength' | 'general' | 'other';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Location = 'gym' | 'home_dumbbells' | 'home_none';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Injury = 'back' | 'knees' | 'shoulders';

export const SEXES: readonly Sex[] = ['male', 'female', 'other'];
export const GOALS: readonly Goal[] = ['lose_fat', 'build_muscle', 'recomp', 'strength', 'general', 'other'];
export const EXPERIENCES: readonly Experience[] = ['beginner', 'intermediate', 'advanced'];
export const LOCATIONS: readonly Location[] = ['gym', 'home_dumbbells', 'home_none'];
export const ACTIVITIES: readonly Activity[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
export const INJURIES: readonly Injury[] = ['back', 'knees', 'shoulders'];
export const SESSION_MINUTES: readonly number[] = [30, 45, 60, 75, 90];

export const PROFILE_LIMITS = {
  nameMax: 30,
  goalNoteMax: 120,
  minAge: 13,
  maxAge: 100,
  minHeightCm: 120,
  maxHeightCm: 230,
  minDays: 1,
  maxDays: 7,
} as const;

/**
 * Every answer is optional on its own: the questionnaire requires language,
 * goal, days and location, and lets the user skip the rest; a user who skipped
 * the whole thing has `{ skipped: true }` and nothing else.
 */
export interface Profile {
  /** The user chose "skip" on the welcome screen — no questions answered. */
  skipped?: true;
  name?: string;
  sex?: Sex;
  /** Stored as a year, so the age the targets use grows by itself. */
  birthYear?: number;
  heightCm?: number;
  goal?: Goal;
  /** Free text for `goal: 'other'` ("לרוץ 10 ק״מ", "לחזור לכושר אחרי לידה"…). */
  goalNote?: string;
  experience?: Experience;
  daysPerWeek?: number;
  /** The weekdays they train on (0 = Sunday), ascending. */
  weekdays?: number[];
  location?: Location;
  /** Daily activity OUTSIDE the workouts — the TDEE multiplier. */
  activity?: Activity;
  sessionMinutes?: number;
  injuries?: Injury[];
}

export interface ProfileSetPayload {
  profile: Profile;
  /** The local date it was answered — for the feed, never for the fold. */
  date: string;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;

const intIn = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined;

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ').slice(0, max);
  return t ? t : undefined;
};

/** Validate a profile from a payload or a stored blob. `null` when it is not one. */
export function normalizeProfile(raw: unknown): Profile | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const p: Profile = {};
  if (r['skipped'] === true) p.skipped = true;
  const name = text(r['name'], PROFILE_LIMITS.nameMax);
  if (name) p.name = name;
  const sex = oneOf(SEXES, r['sex']);
  if (sex) p.sex = sex;
  const by = intIn(r['birthYear'], 1900, 2200);
  if (by !== undefined) p.birthYear = by;
  const h = intIn(r['heightCm'], PROFILE_LIMITS.minHeightCm, PROFILE_LIMITS.maxHeightCm);
  if (h !== undefined) p.heightCm = h;
  const goal = oneOf(GOALS, r['goal']);
  if (goal) p.goal = goal;
  const note = text(r['goalNote'], PROFILE_LIMITS.goalNoteMax);
  if (note) p.goalNote = note;
  const exp = oneOf(EXPERIENCES, r['experience']);
  if (exp) p.experience = exp;
  const days = intIn(r['daysPerWeek'], PROFILE_LIMITS.minDays, PROFILE_LIMITS.maxDays);
  if (days !== undefined) p.daysPerWeek = days;
  if (Array.isArray(r['weekdays'])) {
    const wd = [...new Set(r['weekdays'].filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (wd.length > 0) p.weekdays = wd;
  }
  const loc = oneOf(LOCATIONS, r['location']);
  if (loc) p.location = loc;
  const act = oneOf(ACTIVITIES, r['activity']);
  if (act) p.activity = act;
  const mins = intIn(r['sessionMinutes'], 15, 180);
  if (mins !== undefined) p.sessionMinutes = mins;
  if (Array.isArray(r['injuries'])) {
    const inj = [...new Set(r['injuries'].map((v) => oneOf(INJURIES, v)).filter((v): v is Injury => !!v))];
    if (inj.length > 0) p.injuries = inj;
  }
  return p;
}

/** Save the whole profile (LWW) and mirror it into the state cache. */
export function setProfile(store: DataStore, profile: Profile, date: string): AppEvent {
  const clean = normalizeProfile(profile) ?? {};
  const payload: ProfileSetPayload = { profile: clean, date };
  const ev = store.append('profile_set', payload as unknown as Record<string, unknown>);
  store.update((draft) => {
    draft.profile = clean;
  });
  return ev;
}

/** The fold of one event into `AppState.profile` — shared by the live path and replay. */
export function applyProfileEvent(state: Pick<AppState, 'profile'>, payload: Record<string, unknown>): void {
  state.profile = normalizeProfile(payload['profile']);
}

/* ---------------------------------------------------------------- targets */

/** TDEE multipliers for daily activity outside the workouts (standard Harris/Mifflin factors). */
export const ACTIVITY_FACTOR: Readonly<Record<Activity, number>> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Energy adjustment per goal, as a fraction of TDEE. */
export const GOAL_ENERGY: Readonly<Record<Goal, number>> = {
  lose_fat: -0.2,
  build_muscle: 0.1,
  recomp: -0.1,
  strength: 0.05,
  general: 0,
  other: 0,
};

/** Protein per kilogram of (reference) body weight, per goal. */
export const GOAL_PROTEIN: Readonly<Record<Goal, number>> = {
  lose_fat: 2.0,
  build_muscle: 1.8,
  recomp: 2.0,
  strength: 1.8,
  general: 1.4,
  other: 1.6,
};

/** Never recommend eating below this, whatever the arithmetic says. */
export const CALORIE_FLOOR: Readonly<Record<Sex, number>> = { male: 1500, female: 1200, other: 1350 };

export interface TargetInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
}

export interface Targets {
  /** Basal metabolic rate (Mifflin–St Jeor), kcal/day. */
  bmr: number;
  /** Maintenance: BMR × activity factor. */
  tdee: number;
  /** The recommended daily calories, rounded to 50. */
  calories: number;
  /** The recommended daily protein in grams, rounded to 5. */
  protein: number;
}

/**
 * Mifflin–St Jeor BMR (+5 men, −161 women; the midpoint for "other"), times
 * the activity factor, adjusted for the goal and floored at a safe minimum.
 *
 * Protein is per kilogram of body weight — but for a BMI above 30 it uses the
 * weight at BMI 27 instead: 2 g per kilogram of a 130 kg frame is a number
 * nobody needs and nobody eats.
 */
export function computeTargets(input: TargetInput): Targets {
  const sexK = input.sex === 'male' ? 5 : input.sex === 'female' ? -161 : -78;
  const bmr = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + sexK;
  const tdee = bmr * ACTIVITY_FACTOR[input.activity];
  const raw = tdee * (1 + GOAL_ENERGY[input.goal]);
  const calories = Math.max(CALORIE_FLOOR[input.sex], Math.round(raw / 50) * 50);
  const m = input.heightCm / 100;
  const bmi = input.weightKg / (m * m);
  const refKg = bmi > 30 ? 27 * m * m : input.weightKg;
  const protein = Math.round((refKg * GOAL_PROTEIN[input.goal]) / 5) * 5;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), calories, protein };
}

/** The age a profile implies in `year`, or `null` without a birth year. */
export function ageOf(profile: Profile, year: number): number | null {
  return profile.birthYear === undefined ? null : year - profile.birthYear;
}

/**
 * The targets a profile implies, or `null` when an input is missing (the
 * questionnaire lets every body field be skipped — then there is simply no
 * recommendation, and the user types targets by hand as before).
 */
export function targetsForProfile(profile: Profile, weightKg: number | null, year: number): Targets | null {
  const age = ageOf(profile, year);
  if (
    age === null ||
    weightKg === null ||
    profile.heightCm === undefined ||
    profile.sex === undefined ||
    profile.goal === undefined
  ) {
    return null;
  }
  return computeTargets({
    sex: profile.sex,
    age,
    heightCm: profile.heightCm,
    weightKg,
    activity: profile.activity ?? 'light',
    goal: profile.goal,
  });
}

/* ---------------------------------------------------- the suggested plan */

/**
 * The ready-made plan a profile suggests, as a preset id from
 * `data/presets.ts`, plus the alternatives worth offering beside it.
 *
 * THE RULES TABLE IS THE EXTENSION POINT: the goal-based plan library (one per
 * days × location, each with a men's and a women's variation) plugs in here,
 * and nothing else in onboarding has to change. Today it knows the two shipped
 * plans: three days → the original A/B/C, four or more → the A/B four-day split.
 */
export function recommendPreset(profile: Profile, available: readonly string[]): { id: string; alternatives: string[] } {
  const days = profile.daysPerWeek ?? profile.weekdays?.length ?? 3;
  const wanted = days >= 4 ? 'ab4' : 'builtin3';
  const id = available.includes(wanted) ? wanted : (available[0] ?? wanted);
  return { id, alternatives: available.filter((a) => a !== id) };
}

/**
 * Put a plan's training occurrences on the user's own weekdays.
 *
 * A preset carries its own weekday map (A on Sunday, B on Tuesday…). The user
 * told us THEIR days, so the occurrences are re-laid in order onto those days:
 * occurrence n of the plan's week goes to the user's n-th weekday. When the
 * user trains more days than the plan has occurrences, the plan's days repeat
 * in order (A, B, C, A, B…); when fewer, the first ones are kept. The weekly
 * target follows the result.
 */
export function onWeekdays(doc: PlanDoc, weekdays: readonly number[]): PlanDoc {
  const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0 || doc.days.length === 0) return doc;
  // The plan's own week, in weekday order: which day key trains each occurrence.
  const occurrences: string[] = [];
  for (let wd = 0; wd < 7; wd++) {
    for (const d of doc.days) if ((d.weekdays ?? []).includes(wd)) occurrences.push(d.key);
  }
  // A weekday RANGE is not a training week: the built-in program maps all seven
  // weekdays onto A/B/C (Sun–Mon → A …) to pick the default tab, yet trains each
  // day once. More assigned weekdays than the weekly target means ranges — then
  // the plan's week is simply its days, once each, in order.
  if (occurrences.length === 0 || occurrences.length > doc.weeklyTarget) {
    occurrences.length = 0;
    for (const d of doc.days) occurrences.push(d.key);
  }
  const assigned = new Map<string, number[]>(doc.days.map((d) => [d.key, []]));
  days.forEach((wd, i) => {
    const key = occurrences[i % occurrences.length];
    if (key !== undefined) assigned.get(key)?.push(wd);
  });
  const nextDays: PlanDay[] = doc.days.map((d) => ({ ...d, weekdays: assigned.get(d.key) ?? [] }));
  return {
    version: PLAN_DOC_VERSION,
    rev: doc.rev,
    days: nextDays,
    weeklyTarget: deriveWeeklyTarget(nextDays),
    customExercises: doc.customExercises,
  };
}

/* ------------------------------------------------------- the app's states */

/** Event types that are bookkeeping, not "this person has used the app". */
const NOT_HISTORY = new Set<string>(['data_cleared']);

/**
 * Should the app greet this user with the questionnaire?
 *
 * Only a FRESH install: no profile yet and nothing in the log. Anybody with
 * history — above all the two people the app was built for — is never stopped
 * by a questionnaire after an update. ("Delete all data" deletes the profile
 * too, so a wiped install is greeted again, which is what a wipe means.)
 */
export function needsOnboarding(state: Pick<AppState, 'profile' | 'sessions'>, events: readonly AppEvent[]): boolean {
  if (state.profile !== null) return false;
  if (Object.keys(state.sessions).length > 0) return false;
  return !events.some((e) => !NOT_HISTORY.has(e.type));
}

/**
 * Is this user standing in front of an EMPTY plan?
 *
 * A user who answered (or skipped) the questionnaire but never chose a plan has
 * `plan === null` — which, for everybody else, means "the built-in program".
 * For them it means "nothing yet": the training hub shows the plan picker
 * instead of somebody else's A/B/C. Logging a single workout settles it (they
 * are then training the program the screen showed them).
 */
export function needsPlanChoice(state: Pick<AppState, 'profile' | 'plan' | 'sessions'>): boolean {
  return state.profile !== null && state.plan === null && Object.keys(state.sessions).length === 0;
}
