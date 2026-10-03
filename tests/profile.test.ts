/**
 * The onboarding profile: validation, the LWW fold (live and replay, both merge
 * orders), the targets arithmetic, the suggested plan, re-laying a plan on the
 * user's weekdays, and the two app states it drives (greet / empty plan).
 */
import { describe, expect, it } from 'vitest';

import {
  computeTargets,
  needsOnboarding,
  needsPlanChoice,
  normalizeProfile,
  onWeekdays,
  recommendPreset,
  setProfile,
  targetsForProfile,
} from '../src/core/profile.ts';
import { defaultPlanDoc } from '../src/core/plan.ts';
import { presetById } from '../src/data/presets.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

function store(): LocalStore {
  const map = new Map<string, string>();
  const s: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  return new LocalStore(s);
}

describe('normalizeProfile', () => {
  it('keeps valid answers and drops everything else', () => {
    const p = normalizeProfile({
      name: '  Or  ',
      sex: 'female',
      birthYear: 1994,
      heightCm: 165.4,
      goal: 'other',
      goalNote: '  לרוץ   10 ק״מ ',
      experience: 'beginner',
      daysPerWeek: 3,
      weekdays: [4, 0, 2, 2, 9],
      location: 'home_dumbbells',
      activity: 'light',
      sessionMinutes: 45,
      injuries: ['knees', 'elbows', 'knees'],
      hacker: true,
    });
    expect(p).toEqual({
      name: 'Or',
      sex: 'female',
      birthYear: 1994,
      heightCm: 165,
      goal: 'other',
      goalNote: 'לרוץ 10 ק״מ',
      experience: 'beginner',
      daysPerWeek: 3,
      weekdays: [0, 2, 4],
      location: 'home_dumbbells',
      activity: 'light',
      sessionMinutes: 45,
      injuries: ['knees'],
    });
    expect(normalizeProfile({ sex: 'robot', heightCm: 400 })).toEqual({});
    expect(normalizeProfile(null)).toBeNull();
    expect(normalizeProfile({ skipped: true })).toEqual({ skipped: true });
  });
});

describe('the profile fold', () => {
  it('is last-writer-wins, live and on replay, in either merge order', () => {
    const st = store();
    setProfile(st, { goal: 'lose_fat', daysPerWeek: 3 }, '2026-10-01');
    setProfile(st, { goal: 'build_muscle', daysPerWeek: 4 }, '2026-10-02');
    expect(st.getState().profile).toEqual({ goal: 'build_muscle', daysPerWeek: 4 });
    const events = st.getEvents();
    expect(rebuildFromEvents(events).profile).toEqual({ goal: 'build_muscle', daysPerWeek: 4 });
    expect(rebuildFromEvents([...events].reverse()).profile).toEqual({ goal: 'build_muscle', daysPerWeek: 4 });
  });

  it('is data: "delete all data" removes it', () => {
    const st = store();
    setProfile(st, { goal: 'general' }, '2026-10-01');
    st.clear();
    expect(st.getState().profile).toBeNull();
    expect(rebuildFromEvents(st.getEvents()).profile).toBeNull();
  });
});

describe('targets', () => {
  it('Mifflin–St Jeor × activity, adjusted for the goal', () => {
    // 30-year-old man, 180 cm, 80 kg: BMR = 800 + 1125 − 150 + 5 = 1780.
    const t = computeTargets({ sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'moderate', goal: 'build_muscle' });
    expect(t.bmr).toBe(1780);
    expect(t.tdee).toBe(2759); // 1780 × 1.55
    expect(t.calories).toBe(3050); // × 1.10, rounded to 50
    expect(t.protein).toBe(145); // 80 × 1.8 = 144 → 145
  });

  it('a woman cutting gets −161 and a 20% deficit, never under the floor', () => {
    const t = computeTargets({ sex: 'female', age: 32, heightCm: 165, weightKg: 62, activity: 'light', goal: 'lose_fat' });
    expect(t.bmr).toBe(1330); // 620 + 1031.25 − 160 − 161 = 1330.25
    expect(t.calories).toBeGreaterThanOrEqual(1200);
    const tiny = computeTargets({ sex: 'female', age: 70, heightCm: 145, weightKg: 40, activity: 'sedentary', goal: 'lose_fat' });
    expect(tiny.calories).toBe(1200);
  });

  it('protein uses a BMI-27 reference weight above BMI 30', () => {
    const t = computeTargets({ sex: 'male', age: 40, heightCm: 175, weightKg: 130, activity: 'light', goal: 'lose_fat' });
    // 27 × 1.75² = 82.7 kg × 2.0 = 165
    expect(t.protein).toBe(165);
  });

  it('no recommendation when an input was skipped', () => {
    expect(targetsForProfile({ sex: 'male', heightCm: 180, goal: 'general' }, 80, 2026)).toBeNull();
    expect(targetsForProfile({ sex: 'male', heightCm: 180, goal: 'general', birthYear: 1996 }, null, 2026)).toBeNull();
    expect(targetsForProfile({ sex: 'male', heightCm: 180, goal: 'general', birthYear: 1996 }, 80, 2026)?.calories).toBeGreaterThan(0);
  });
});

describe('the suggested plan', () => {
  const ids = ['builtin3', 'ab4'];
  it('three days → the original A/B/C, four or more → the A/B split', () => {
    expect(recommendPreset({ daysPerWeek: 3 }, ids).id).toBe('builtin3');
    expect(recommendPreset({ daysPerWeek: 2 }, ids).id).toBe('builtin3');
    expect(recommendPreset({ daysPerWeek: 5 }, ids)).toEqual({ id: 'ab4', alternatives: ['builtin3'] });
  });

  it('re-lays a plan on the user\'s weekdays, repeating days in order', () => {
    const doc = defaultPlanDoc();
    const mine = onWeekdays(doc, [1, 3, 5]);
    expect(mine.days.map((d) => d.weekdays)).toEqual([[1], [3], [5]]);
    expect(mine.weeklyTarget).toBe(3);
    const four = onWeekdays(doc, [0, 1, 3, 5]);
    expect(four.days.map((d) => d.weekdays)).toEqual([[0, 5], [1], [3]]);
    expect(four.weeklyTarget).toBe(4);
    const ab = presetById('ab4')?.build();
    if (!ab) throw new Error('no ab4');
    const two = onWeekdays(ab, [2, 6]);
    expect(two.days.flatMap((d) => d.weekdays ?? []).sort()).toEqual([2, 6]);
  });
});

describe('the app states the profile drives', () => {
  it('a fresh install is greeted; anybody with history never is', () => {
    const st = store();
    expect(needsOnboarding(st.getState(), st.getEvents())).toBe(true);
    const old = store();
    old.append('set_completed', { date: '2025-01-05', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    expect(needsOnboarding(old.getState(), old.getEvents())).toBe(false);
    setProfile(st, { skipped: true }, '2026-10-03');
    expect(needsOnboarding(st.getState(), st.getEvents())).toBe(false);
  });

  it('an answered profile without a plan stands in front of an empty plan', () => {
    const st = store();
    expect(needsPlanChoice(st.getState())).toBe(false); // no profile: the built-in program, as always
    setProfile(st, { skipped: true }, '2026-10-03');
    expect(needsPlanChoice(st.getState())).toBe(true);
  });
});
