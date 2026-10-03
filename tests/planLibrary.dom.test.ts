/**
 * @vitest-environment jsdom
 *
 * The plan editor's "תוכניות מוכנות" sheet with the plan library: the
 * originals first, "plans for you" at the profile's location, the rest of the
 * library grouped by location (collapsible), and a library pick built with the
 * profile's options.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PLAN_PRESETS } from '../src/data/presets.ts';
import { defaultPlanDoc, savePlan } from '../src/core/plan.ts';
import { setProfile, type Profile } from '../src/core/profile.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.confirm = () => true;
});
afterEach(() => setLocale('he'));

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function mount(profile: Profile | null, locale: 'he' | 'en' = 'he'): LocalStore {
  const store = new LocalStore(fakeStorage());
  store.update((d) => {
    d.ui.locale = locale;
  });
  if (profile) setProfile(store, profile, '2026-10-03');
  savePlan(store, defaultPlanDoc());
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const timer = new RestTimer({
    bar: el('timerBar'),
    time: el('tTime'),
    prog: el('tProg'),
    title: el('tTitle'),
    plus: el('tPlus'),
    minus: el('tMinus'),
    pause: el('tPause'),
    reset: el('tReset'),
    close: el('tClose'),
  });
  createApp(store, timer).render();
  click('.tab[data-view="A"]');
  click('#btnEditPlan');
  click('#plPresets');
  return store;
}

const groups = (): HTMLDetailsElement[] => [...document.querySelectorAll<HTMLDetailsElement>('.pl-sheet .pl-group')];

describe('the presets sheet with the library', () => {
  it('without a profile: the originals, then the library by location, all collapsed', () => {
    mount(null);
    expect([...document.querySelectorAll<HTMLElement>('[data-preset]')].map((b) => b.dataset['preset'])).toEqual(
      PLAN_PRESETS.map((p) => p.id),
    );
    expect(document.querySelector('.pl-group-head')?.textContent).toBe('התוכניות המקוריות');
    const g = groups();
    expect(g.map((d) => d.querySelector('.pl-group-title')?.textContent)).toEqual([
      'ספריית התוכניות · חדר כושר',
      'ספריית התוכניות · בית, משקולות',
      'ספריית התוכניות · בלי ציוד',
    ]);
    expect(g.every((d) => !d.open)).toBe(true);
    expect(g.map((d) => d.querySelectorAll('[data-lib-preset]').length)).toEqual([10, 10, 10]);
    expect(g[0]?.querySelector('.pl-group-count')?.textContent).toBe('10 תוכניות');
  });

  it('with a profile: "plans for you" at its location, open, the recommended plan first and marked', () => {
    mount({ sex: 'female', daysPerWeek: 4, weekdays: [0, 1, 3, 4], location: 'home_dumbbells', goal: 'build_muscle' });
    const g = groups();
    expect(g).toHaveLength(3);
    expect(g[0]?.open).toBe(true);
    expect(g[0]?.querySelector('.pl-group-title')?.textContent).toBe('מתאימות לך · בית, משקולות');
    const ids = [...(g[0]?.querySelectorAll<HTMLElement>('[data-lib-preset]') ?? [])].map((b) => b.dataset['libPreset']);
    expect(ids[0]).toBe('lib_4_home_dumbbells_f');
    expect(ids).toHaveLength(10);
    expect(ids.slice(0, 5).every((id) => id?.endsWith('_f'))).toBe(true);
    expect(g[0]?.querySelector('[data-lib-preset="lib_4_home_dumbbells_f"] .pl-preset-rec')?.textContent).toBe('מומלצת');
    expect(g.slice(1).map((d) => d.querySelector('.pl-group-title')?.textContent)).toEqual([
      'ספריית התוכניות · חדר כושר',
      'ספריית התוכניות · בלי ציוד',
    ]);
  });

  it('picking a library plan loads it into the draft, built for the profile', () => {
    const store = mount({
      sex: 'male',
      daysPerWeek: 3,
      weekdays: [1, 3, 5],
      location: 'home_none',
      goal: 'lose_fat',
      experience: 'beginner',
    });
    click('[data-lib-preset="lib_3_home_none_m"]');
    expect(document.querySelector('.pl-sheet')).toBeNull();
    const days = [...document.querySelectorAll<HTMLElement>('.pl-day')];
    expect(days).toHaveLength(3);
    expect(days[0]?.textContent).toContain('פול באדי A');
    const rows = [...document.querySelectorAll<HTMLElement>('.pl-row')].map((el) => el.dataset['row']);
    expect(rows).toHaveLength(5);
    expect(rows.at(-1)).toBe('w10');
    // only the draft changed — 💾 has not been pressed
    expect(store.getState().plan?.days.map((d) => d.key)).toEqual(['A', 'B', 'C']);
    click('#plSave');
    const saved = store.getState().plan;
    expect(saved?.days.map((d) => d.weekdays)).toEqual([[1], [3], [5]]);
    expect(saved?.days[0]?.exercises.every((r) => r.sets <= 3)).toBe(true);
  });

  it('speaks English in English — names, groups, and the days a pick builds', () => {
    mount({ sex: 'male', daysPerWeek: 6, location: 'gym', goal: 'strength' }, 'en');
    const sheet = document.querySelector('.pl-sheet')?.textContent ?? '';
    expect(sheet).not.toMatch(/[֐-׿]/);
    expect(groups()[0]?.querySelector('.pl-group-title')?.textContent).toBe('Plans for you · Gym');
    expect(document.querySelector('[data-lib-preset="lib_6_gym_m"] b')?.textContent).toContain('Push/Pull/Legs · 6 days · Gym · Men');
    click('[data-lib-preset="lib_6_gym_m"]');
    const days = [...document.querySelectorAll<HTMLElement>('.pl-day')].map((d) => d.textContent ?? '');
    expect(days).toHaveLength(6);
    expect(days[0]).toContain('Push A');
    expect(days[5]).toContain('Legs B');
  });
});
