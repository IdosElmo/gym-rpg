/**
 * core/onboarding.ts — what finishing (or skipping) the questionnaire WRITES.
 *
 * The questionnaire (ui/onboarding.ts) holds its answers in memory while it is
 * in progress; nothing reaches the store until the last step. Then this module
 * appends, in a fixed order, the events that already exist for each piece of
 * what was answered (see core/profile.ts — the profile owns none of them):
 *
 *   1. `profile_set`            — the answers themselves (LWW, whole profile);
 *   2. `weight_logged`          — today's weigh-in, when a weight was given;
 *   3. `weight_target_set`      — the goal weight, when one was given;
 *   4. `nutrition_targets_set`  — the daily targets, when the user kept them;
 *   5. `character_selected`     — the character's body, for male / female;
 *   6. `plan_updated`           — the chosen preset, built for the profile
 *                                 (a library plan takes the goal, experience,
 *                                 session length and injuries) and laid on the
 *                                 user's own weekdays; the EMPTY plan and "keep
 *                                 my plan" append nothing.
 *
 * RE-ANSWERING IS IDEMPOTENT. The same flow re-opens from הגדרות in an edit
 * mode, prefilled with what the store already says. Each step above is skipped
 * when it would only repeat what is already there — an unchanged profile, the
 * weight of the latest weigh-in, the goal weight and targets already set, the
 * body already played — so "open, look, finish" writes nothing at all.
 *
 * Deterministic: today's date, the clock time, the weigh-in id and the year
 * arrive in `ctx`; nothing here reads a clock or mints an id.
 */

import type { DataStore } from '../storage/DataStore.ts';
import { buildPresetFor, presetById } from '../data/presets.ts';
import { selectBody } from './game.ts';
import { setTargets } from './nutrition.ts';
import { PLAN_DOC_VERSION, type PlanDoc } from '../data/planTypes.ts';
import { deriveWeeklyTarget, makePlanDay, newDayKey, savePlan } from './plan.ts';
import { normalizeProfile, setProfile, type Profile } from './profile.ts';
import { logWeight, setWeightTarget, weightEntries } from './weight.ts';

/** What the questionnaire hands over. Weights in KILOGRAMS, height (in `profile`) in cm. */
export interface OnboardingAnswers {
  /** The answers. `birthYear` may be left out in favour of `age`. */
  profile: Profile;
  /** Age in years — turned into `birthYear` with `ctx.year`. Wins over `profile.birthYear`. */
  age?: number | null;
  /** Today's body weight, kg. */
  weightKg?: number | null;
  /** The goal weight, kg. */
  goalWeightKg?: number | null;
  /**
   * The daily targets to save — the computed recommendation as kept or edited.
   * Absent / `null` = do not touch the targets (skipped body, or an edit that
   * did not tick "update my targets").
   */
  targets?: { calories: number | null; protein: number | null } | null;
}

/**
 * The plan the user leaves the questionnaire with:
 *   - `{ preset }` — a ready-made plan, built and laid on their weekdays;
 *   - `'empty'`    — nothing: the training hub then shows the plan picker;
 *   - `'keep'`     — whatever is there now (the edit mode's default).
 */
export type PlanChoice = 'empty' | 'keep' | { preset: string };

export interface OnboardingCtx {
  /** Today, `YYYY-MM-DD` (the profile's date and the weigh-in's). */
  date: string;
  /** Now, `HH:MM` — the weigh-in's time. */
  time: string;
  /** The weigh-in's id (the UI mints a uuid; tests pass a fixed one). */
  weightId: string;
  /** This year — `age` → `birthYear`. */
  year: number;
  /** The clock for the plan/character events. */
  now: Date;
}

/** Two kilogram figures that read as the same number on the scale (0.1 kg). */
function sameKg(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.round(a * 10) === Math.round(b * 10);
}

/** The profile `answers` describe, with the age resolved to a birth year. */
export function profileOf(answers: OnboardingAnswers, year: number): Profile {
  const p: Profile = { ...answers.profile };
  delete p.skipped;
  if (typeof answers.age === 'number' && Number.isFinite(answers.age)) p.birthYear = year - Math.round(answers.age);
  return normalizeProfile(p) ?? {};
}

/**
 * Finish the questionnaire: append what the answers imply, in the order the
 * module comment lists, skipping anything that would only repeat the store.
 * Returns the profile it saved (or kept).
 */
export function finishOnboarding(
  store: DataStore,
  answers: OnboardingAnswers,
  choice: PlanChoice,
  ctx: OnboardingCtx,
): Profile {
  const profile = profileOf(answers, ctx.year);
  const state = store.getState();

  // 1. The answers.
  if (state.profile === null || JSON.stringify(state.profile) !== JSON.stringify(profile)) {
    setProfile(store, profile, ctx.date);
  }

  // 2. Today's weigh-in — unless it is the weight the scale already says.
  const n = store.getState().nutrition;
  const latest = weightEntries(n).at(-1) ?? null;
  if (typeof answers.weightKg === 'number' && !sameKg(answers.weightKg, latest?.kg)) {
    logWeight(store, { date: ctx.date, time: ctx.time, kg: answers.weightKg, note: '' }, ctx.weightId);
  }

  // 3. The goal weight.
  if (typeof answers.goalWeightKg === 'number' && !sameKg(answers.goalWeightKg, n.weightTarget)) {
    setWeightTarget(store, answers.goalWeightKg);
  }

  // 4. The daily targets.
  const t = answers.targets;
  if (t && (t.calories !== null || t.protein !== null)) {
    const cur = store.getState().nutrition.targets;
    if (cur.calories !== t.calories || cur.protein !== t.protein) setTargets(store, t);
  }

  // 5. The character's body ("other" leaves it as it is).
  if (profile.sex === 'male' || profile.sex === 'female') selectBody(store, profile.sex, ctx.now);

  // 6. The plan.
  if (typeof choice === 'object') {
    const preset = presetById(choice.preset);
    if (preset) {
      // A library plan is BUILT for this profile (goal, experience, session
      // length, injuries, weekdays); an original plan is laid on the weekdays.
      savePlan(store, buildPresetFor(preset, profile), ctx.now.getTime());
    }
  }
  return profile;
}

/** "דלג" on the welcome screen: no answers, no plan — the empty plan awaits. */
export function skipOnboarding(store: DataStore, date: string): void {
  setProfile(store, { skipped: true }, date);
}

/**
 * The plan editor's starting point for "build my own" on an EMPTY plan: one
 * empty day (a plan may not have zero — `PLAN_LIMITS.minDays`), named in the
 * reader's language and trained on the user's weekdays when they gave some.
 * It is only a DRAFT: nothing is saved until the editor's 💾, and the editor
 * refuses an empty day, so the user adds exercises first.
 */
export function blankPlanDoc(label: string, weekdays: readonly number[] = []): PlanDoc {
  const days = [makePlanDay(newDayKey(), label, [...weekdays].sort((a, b) => a - b), [])];
  return { version: PLAN_DOC_VERSION, rev: 0, days, weeklyTarget: deriveWeeklyTarget(days), customExercises: [] };
}
