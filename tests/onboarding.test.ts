/**
 * Finishing / skipping the opening questionnaire (core/onboarding.ts): exactly
 * which events each answer set appends and in which order, the unit
 * conversions the UI hands over, the plan choice (preset on the user's
 * weekdays / empty / keep), the character body, idempotent re-answering, and
 * the empty plan's one-empty-day editor draft.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { blankPlanDoc, finishOnboarding, skipOnboarding, type OnboardingCtx } from '../src/core/onboarding.ts';
import { gameOf } from '../src/core/game.ts';
import { PLAN_LIMITS, validatePlanDoc } from '../src/core/plan.ts';
import { needsOnboarding, needsPlanChoice, type Profile } from '../src/core/profile.ts';
import { selectedCharacter } from '../src/core/xp.ts';
import { weightEntries } from '../src/core/weight.ts';
import { setUnits, displayToKg, ftInToCm } from '../src/i18n/units.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

function store(): LocalStore {
  const map = new Map<string, string>();
  const s: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  return new LocalStore(s);
}

const NOW = new Date(2026, 9, 3, 8, 30);
const ctx = (over: Partial<OnboardingCtx> = {}): OnboardingCtx => ({
  date: '2026-10-03',
  time: '08:30',
  weightId: 'w-onb-1',
  year: 2026,
  now: NOW,
  ...over,
});

const FULL: Profile = {
  name: 'נועה',
  sex: 'female',
  heightCm: 165,
  goal: 'recomp',
  experience: 'beginner',
  daysPerWeek: 3,
  weekdays: [0, 2, 4],
  location: 'gym',
  activity: 'light',
  sessionMinutes: 60,
  injuries: ['knees'],
};

const types = (st: LocalStore): string[] => st.getEvents().map((e) => e.type);

afterEach(() => setUnits('metric'));

describe('finishOnboarding', () => {
  it('a full answer set appends profile, weigh-in, goal weight, targets, body and plan — in that order', () => {
    const st = store();
    finishOnboarding(
      st,
      { profile: FULL, age: 32, weightKg: 62, goalWeightKg: 58, targets: { calories: 1650, protein: 125 } },
      { preset: 'builtin3' },
      ctx(),
    );
    expect(types(st)).toEqual([
      'profile_set',
      'weight_logged',
      'weight_target_set',
      'nutrition_targets_set',
      'character_selected',
      'plan_updated',
    ]);
    const s = st.getState();
    expect(s.profile).toEqual({ ...FULL, birthYear: 1994 });
    expect(weightEntries(s.nutrition)).toEqual([{ id: 'w-onb-1', date: '2026-10-03', time: '08:30', kg: 62, note: '' }]);
    expect(s.nutrition.weightTarget).toBe(58);
    expect(s.nutrition.targets).toEqual({ calories: 1650, protein: 125 });
    expect(selectedCharacter(gameOf(st)).geometry).toBe('female');
    // The live state is the fold of the log.
    expect(rebuildFromEvents(st.getEvents()).profile).toEqual(s.profile);
    expect(needsOnboarding(s, st.getEvents())).toBe(false);
    expect(needsPlanChoice(s)).toBe(false);
  });

  it('a preset is laid on the user’s own weekdays', () => {
    const st = store();
    finishOnboarding(st, { profile: { ...FULL, daysPerWeek: 4, weekdays: [1, 2, 4, 5] } }, { preset: 'ab4' }, ctx());
    const plan = st.getState().plan;
    expect(plan).not.toBeNull();
    expect(plan?.days.map((d) => d.weekdays ?? [])).toEqual([[1, 4], [2], [5]]);
    expect(plan?.weeklyTarget).toBe(4);

    const st3 = store();
    finishOnboarding(st3, { profile: { goal: 'general', daysPerWeek: 3, weekdays: [1, 3, 5], location: 'gym' } }, { preset: 'builtin3' }, ctx());
    expect(st3.getState().plan?.days.map((d) => [d.key, d.weekdays])).toEqual([
      ['A', [1]],
      ['B', [3]],
      ['C', [5]],
    ]);
  });

  it('only the required answers + the empty plan: one profile_set, no plan, the plan picker awaits', () => {
    const st = store();
    finishOnboarding(st, { profile: { goal: 'general', daysPerWeek: 2, weekdays: [0, 3], location: 'home_none' } }, 'empty', ctx());
    expect(types(st)).toEqual(['profile_set']);
    expect(st.getState().plan).toBeNull();
    expect(needsPlanChoice(st.getState())).toBe(true);
  });

  it('"other" leaves the character alone; male on the default body appends nothing either', () => {
    const other = store();
    finishOnboarding(other, { profile: { ...FULL, sex: 'other' } }, 'empty', ctx());
    expect(types(other)).toEqual(['profile_set']);
    const male = store();
    finishOnboarding(male, { profile: { ...FULL, sex: 'male' } }, 'empty', ctx());
    expect(selectedCharacter(gameOf(male)).geometry).toBe('male');
    expect(types(male)).toEqual(['profile_set']);
  });

  it('weights arrive in kilograms: the UI converts pounds and feet/inches', () => {
    setUnits('imperial');
    const kg = displayToKg(150);
    const goal = displayToKg(140);
    const cm = ftInToCm(5, 10);
    expect(cm).toBe(177.8);
    const st = store();
    finishOnboarding(st, { profile: { ...FULL, heightCm: cm }, weightKg: kg, goalWeightKg: goal }, 'empty', ctx());
    const s = st.getState();
    expect(s.profile?.heightCm).toBe(178);
    expect(weightEntries(s.nutrition)[0]?.kg).toBeCloseTo(68.04, 1);
    expect(s.nutrition.weightTarget).toBeCloseTo(63.5, 1);
  });

  it('the age becomes a birth year against ctx.year', () => {
    const st = store();
    finishOnboarding(st, { profile: FULL, age: 40 }, 'empty', ctx({ year: 2030 }));
    expect(st.getState().profile?.birthYear).toBe(1990);
  });

  it('re-answering with nothing changed (edit mode, "keep") writes nothing at all', () => {
    const st = store();
    const answers = { profile: FULL, age: 32, weightKg: 62, goalWeightKg: 58, targets: { calories: 1650, protein: 125 } };
    finishOnboarding(st, answers, { preset: 'builtin3' }, ctx());
    const before = st.getEvents().length;
    finishOnboarding(st, answers, 'keep', ctx({ weightId: 'w-onb-2' }));
    expect(st.getEvents().length).toBe(before);
    // A changed answer writes exactly that — and still keeps the plan.
    const plan = st.getState().plan;
    finishOnboarding(st, { ...answers, profile: { ...FULL, goal: 'strength' }, weightKg: 61.5 }, 'keep', ctx({ weightId: 'w-onb-3' }));
    expect(types(st).slice(before)).toEqual(['profile_set', 'weight_logged']);
    expect(st.getState().plan).toEqual(plan);
    expect(weightEntries(st.getState().nutrition).map((w) => w.kg)).toEqual([62, 61.5]);
  });
});

describe('skipOnboarding', () => {
  it('saves { skipped: true } and nothing else: no plan, the picker awaits', () => {
    const st = store();
    expect(needsOnboarding(st.getState(), st.getEvents())).toBe(true);
    skipOnboarding(st, '2026-10-03');
    expect(types(st)).toEqual(['profile_set']);
    expect(st.getState().profile).toEqual({ skipped: true });
    expect(st.getState().plan).toBeNull();
    expect(needsOnboarding(st.getState(), st.getEvents())).toBe(false);
    expect(needsPlanChoice(st.getState())).toBe(true);
  });
});

describe('blankPlanDoc', () => {
  it('is ONE empty day on the user’s weekdays — the minimum a plan may have, and not yet saveable', () => {
    const doc = blankPlanDoc('אימון חדש', [4, 0, 2]);
    expect(doc.days).toHaveLength(PLAN_LIMITS.minDays);
    expect(doc.days[0]?.label).toBe('אימון חדש');
    expect(doc.days[0]?.weekdays).toEqual([0, 2, 4]);
    expect(doc.days[0]?.exercises).toEqual([]);
    expect(doc.weeklyTarget).toBe(3);
    // The editor refuses to save it until the day has an exercise.
    expect(validatePlanDoc(doc)).toHaveLength(1);
    expect(blankPlanDoc('New workout').days[0]?.weekdays).toBeUndefined();
  });
});
