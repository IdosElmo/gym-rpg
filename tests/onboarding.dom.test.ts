/**
 * @vitest-environment jsdom
 *
 * The opening questionnaire in the real shell: who sees it (a fresh store, and
 * only when the app asks for it), the whole flow in Hebrew and in English, the
 * required steps holding the CTA, skip → the empty-plan picker → a plan, and
 * the edit mode from הגדרות keeping the plan by default.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp, type AppHooks } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { setUnits } from '../src/i18n/units.ts';
import { setTargets } from '../src/core/nutrition.ts';
import { gameOf } from '../src/core/game.ts';
import { selectedCharacter } from '../src/core/xp.ts';
import { weightEntries } from '../src/core/weight.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.className = '';
  document.documentElement.setAttribute('lang', 'he');
  document.documentElement.setAttribute('dir', 'rtl');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});

afterEach(() => {
  setLocale('he');
  setUnits('metric');
});

function mount(hooks: AppHooks = { onboarding: true }, seed?: (s: LocalStore) => void): LocalStore {
  const store = new LocalStore(fakeStorage());
  seed?.(store);
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
  createApp(store, timer, hooks).render();
  return store;
}

function q(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no ${sel}`);
  return el;
}
function click(sel: string): void {
  q(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
function type(sel: string, value: string): void {
  const el = q(sel) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const ctaDisabled = (): boolean => (q('#onbNext') as HTMLButtonElement).disabled;
const title = (): string => q('#onbTitle').textContent ?? '';
const step = (): string => document.querySelector('.onb-step')?.textContent ?? '';
const types = (s: LocalStore): string[] => s.getEvents().map((e) => e.type);

describe('who is greeted', () => {
  it('a fresh store with the flag: the questionnaire, instead of the app', () => {
    mount();
    expect(document.getElementById('onb')).not.toBeNull();
    expect(document.body.classList.contains('onb-open')).toBe(true);
    expect(q('#main').innerHTML).toBe('');
    expect(q('#tabs').innerHTML).toBe('');
    expect(title()).toBe('Ori');
  });

  it('without the flag: never — the app exactly as before', () => {
    mount({});
    expect(document.getElementById('onb')).toBeNull();
    expect(document.querySelector('#main .log-row')).not.toBeNull();
    expect(document.body.classList.contains('onb-open')).toBe(false);
  });

  it('a store with history: never, even with the flag — it gets a quiet "complete your profile" card instead', () => {
    const store = mount({ onboarding: true }, (s) => {
      setTargets(s, { calories: 2400, protein: 160 });
    });
    expect(document.getElementById('onb')).toBeNull();
    expect(document.querySelector('#main .log-row')).not.toBeNull();
    click('[data-hub="SE"]');
    expect(q('#profileCard').textContent).toContain('השלמת פרופיל');
    // It opens the questionnaire in the edit mode, with no plan change by default.
    click('#btnProfileEdit');
    expect(q('#onb').getAttribute('data-mode')).toBe('edit');
    expect(document.getElementById('onbSkipAll')).toBeNull();
    click('#onbCancel');
    expect(document.getElementById('onb')).toBeNull();
    expect(store.getState().profile).toBeNull();
  });

  it('a store with history and no flag: no profile card at all', () => {
    mount({}, (s) => {
      setTargets(s, { calories: 2400, protein: 160 });
    });
    click('[data-hub="SE"]');
    expect(document.getElementById('profileCard')).toBeNull();
  });
});

describe('the Hebrew flow', () => {
  it('walks all eight questions, the required ones holding the CTA, and lands on the workout', () => {
    const store = mount();
    expect(q('#onbNext').textContent).toBe('בואו נתחיל');
    click('#onbNext');

    // 1 — about you (skippable)
    expect(step()).toBe('1/8');
    expect(title()).toBe('קצת עליך');
    expect(ctaDisabled()).toBe(false);
    type('#onbName', 'נועה');
    click('[data-pick="sex"][data-val="female"]');
    expect(q('[data-pick="sex"][data-val="female"]').getAttribute('aria-checked')).toBe('true');
    click('#onbNext');

    // 2 — body (skippable, but a bad number holds the CTA)
    expect(step()).toBe('2/8');
    type('#onbAge', '7');
    expect(ctaDisabled()).toBe(true);
    expect(q('#onbAgeErr').textContent).toContain('13');
    type('#onbAge', '32');
    type('#onbHeight', '165');
    type('#onbWeight', '62');
    type('#onbGoalW', '58');
    expect(ctaDisabled()).toBe(false);
    click('#onbNext');

    // 3 — goal (required)
    expect(title()).toBe('מה המטרה העיקרית שלך?');
    expect(document.getElementById('onbSkip')).toBeNull();
    expect(ctaDisabled()).toBe(true);
    click('[data-pick="goal"][data-val="other"]');
    type('#onbGoalNote', 'לרוץ 10 ק״מ');
    expect(ctaDisabled()).toBe(false);
    click('#onbNext');

    // 4 — experience (skippable)
    click('[data-pick="experience"][data-val="beginner"]');
    click('#onbNext');

    // 5 — schedule (required; the weekdays must match the count)
    expect(ctaDisabled()).toBe(true);
    click('[data-chip="days"][data-val="3"]');
    const onDays = [...document.querySelectorAll('[data-chip="wd"][aria-pressed="true"]')].map((b) => (b as HTMLElement).dataset['val']);
    expect(onDays).toEqual(['0', '2', '4']); // a spread, in Sunday-first display order
    expect(ctaDisabled()).toBe(false);
    click('[data-chip="wd"][data-val="2"]');
    expect(ctaDisabled()).toBe(true);
    expect(q('#onbWdCount').textContent).toBe('נבחרו 2 מתוך 3');
    click('[data-chip="wd"][data-val="2"]');
    click('[data-chip="minutes"][data-val="60"]');
    click('#onbNext');

    // 6 — location (required)
    expect(ctaDisabled()).toBe(true);
    click('[data-pick="location"][data-val="gym"]');
    click('#onbNext');

    // 7 — activity + injuries (skippable)
    click('[data-pick="activity"][data-val="light"]');
    click('[data-chip="injury"][data-val="knees"]');
    click('#onbNext');

    // 8 — summary: computed targets, the recommended plan
    expect(step()).toBe('8/8');
    expect(q('.onb-targets').textContent).toContain('המלצה — אפשר לשנות');
    expect((q('#onbCal') as HTMLInputElement).value).toBe('1850'); // goal "other": maintenance, rounded to 50
    expect(q('.onb-plan').textContent).toContain('פול באדי · 3 ימים · חדר כושר · נשים');
    expect(q('.onb-plan').textContent).toContain('ראשון · שלישי · חמישי');
    type('#onbPro', '120');
    expect(q('#onbNext').textContent).toBe('יאללה, מתחילים!');
    click('#onbNext');

    // Done: the app, on the plan's first workout, laid on the chosen weekdays.
    expect(document.getElementById('onb')).toBeNull();
    expect(document.body.classList.contains('onb-open')).toBe(false);
    expect(document.querySelector('#main .log-row')).not.toBeNull();
    const tabs = [...document.querySelectorAll('#tabs .tab .d')].map((t) => t.textContent);
    expect(tabs).toEqual(['ראשון', 'שלישי', 'חמישי']);
    expect(types(store)).toEqual([
      'profile_set',
      'weight_logged',
      'weight_target_set',
      'nutrition_targets_set',
      'character_selected',
      'plan_updated',
    ]);
    const s = store.getState();
    expect(s.profile?.goalNote).toBe('לרוץ 10 ק״מ');
    expect(s.nutrition.targets).toEqual({ calories: 1850, protein: 120 });
    expect(selectedCharacter(gameOf(store)).geometry).toBe('female');
    expect(q('#toast').textContent).toBe('ברוכים הבאים, נועה! 💪');
  });

  it('back walks the steps backwards and keeps the answers', () => {
    mount();
    click('#onbNext');
    click('[data-pick="sex"][data-val="male"]');
    click('#onbNext');
    click('#onbBack');
    expect(step()).toBe('1/8');
    expect(q('[data-pick="sex"][data-val="male"]').getAttribute('aria-checked')).toBe('true');
    click('#onbBack');
    expect(document.querySelector('.onb-top')).toBeNull(); // the welcome has no progress bar
  });
});

describe('the English flow', () => {
  it('switching language on the welcome step flips the direction at once; pounds and feet are converted', () => {
    const store = mount();
    click('[data-locale="en"]');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(store.getState().ui.locale).toBe('en');
    expect(q('#onbNext').textContent).toBe('Let’s start');
    click('[data-units="imperial"]');
    expect(store.getState().ui.units).toBe('imperial');
    click('#onbNext');

    click('[data-pick="sex"][data-val="male"]');
    click('#onbNext');
    type('#onbAge', '30');
    type('#onbFt', '5');
    type('#onbIn', '11');
    type('#onbWeight', '180');
    expect(q('.onb-body').textContent).toContain('lb');
    click('#onbNext');
    expect(title()).toBe('What’s your main goal?');
    click('[data-pick="goal"][data-val="build_muscle"]');
    click('#onbNext');
    click('#onbSkip'); // experience
    click('[data-chip="days"][data-val="4"]');
    const onDays = [...document.querySelectorAll('[data-chip="wd"][aria-pressed="true"]')].map((b) => (b as HTMLElement).dataset['val']);
    expect(onDays).toEqual(['1', '2', '4', '5']); // Monday-first
    click('#onbNext');
    click('[data-pick="location"][data-val="gym"]');
    click('#onbNext');
    click('#onbSkip'); // activity
    expect(title()).toBe('You’re all set');
    expect(q('.onb-plan').textContent).toContain('Upper/Lower · 4 days · Gym · Men');
    click('#onbNext');

    const s = store.getState();
    expect(s.profile?.heightCm).toBe(180); // 5′11″ = 180.3 cm
    expect(weightEntries(s.nutrition)[0]?.kg).toBeCloseTo(81.65, 1); // 180 lb
    expect(s.plan?.days.map((d) => d.weekdays ?? [])).toEqual([[1], [2], [4], [5]]);
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(q('#toast').textContent).toBe('Welcome! 💪');
  });

  it('a skipped body means no recommendation — the targets are left for later', () => {
    const store = mount();
    click('[data-locale="en"]');
    click('#onbNext');
    click('#onbSkip');
    click('#onbSkip');
    click('[data-pick="goal"][data-val="general"]');
    click('#onbNext');
    click('#onbNext');
    click('[data-chip="days"][data-val="2"]');
    click('#onbNext');
    click('[data-pick="location"][data-val="home_none"]');
    click('#onbNext');
    click('#onbNext');
    expect(document.getElementById('onbCal')).toBeNull();
    expect(q('.onb-targets').textContent).toContain('set your targets later');
    click('#onbNext');
    expect(types(store)).toEqual(['profile_set', 'plan_updated']);
    expect(store.getState().nutrition.targets).toEqual({ calories: null, protein: null });
  });
});

describe('skip → the empty plan', () => {
  it('skipping everything leaves no plan; the hub is the plan picker; the recommended plan starts the workout', () => {
    const store = mount();
    click('#onbSkipAll');
    expect(document.getElementById('onb')).toBeNull();
    expect(types(store)).toEqual(['profile_set']);
    expect(store.getState().plan).toBeNull();
    // No day tabs, a picker instead of a workout.
    expect(document.querySelector('#tabs .sub-row')).toBeNull();
    expect(document.querySelector('#main .log-row')).toBeNull();
    expect(q('#planChoice .pc-title').textContent).toBe('עוד אין לך תוכנית');
    expect(q('#header .app-title').textContent).toContain('בחירת תוכנית');
    expect(q('.pc-main').textContent).toContain('היפרטרופיה 3 ימים');
    // The other hubs work normally.
    click('[data-hub="NU"]');
    expect(document.getElementById('planChoice')).toBeNull();
    click('[data-hub="SE"]');
    expect(q('#profileCard').textContent).toContain('עוד לא ענית על השאלון');
    click('#btnPlanChoose');
    expect(document.getElementById('planChoice')).not.toBeNull();

    click('.pc-start');
    expect(store.getState().plan).not.toBeNull();
    expect(document.getElementById('planChoice')).toBeNull();
    expect(document.querySelector('#main .log-row')).not.toBeNull();
    expect(document.querySelectorAll('#tabs .sub-row .tab')).toHaveLength(3);
  });

  it('"build my own" opens the editor on ONE empty day', () => {
    const store = mount();
    click('#onbSkipAll');
    click('#pcBuild');
    expect(store.getState().ui.view).toBe('PL');
    expect(document.querySelectorAll('.pl-day')).toHaveLength(1);
    expect(document.querySelectorAll('.pl-row')).toHaveLength(0);
    expect(store.getState().plan).toBeNull();
  });
});

describe('edit mode from הגדרות', () => {
  function onboarded(): LocalStore {
    const store = mount();
    click('#onbNext');
    click('[data-pick="sex"][data-val="female"]');
    click('#onbNext');
    type('#onbAge', '32');
    type('#onbHeight', '165');
    type('#onbWeight', '62');
    click('#onbNext');
    click('[data-pick="goal"][data-val="recomp"]');
    click('#onbNext');
    click('#onbNext');
    click('[data-chip="days"][data-val="4"]');
    click('#onbNext');
    click('[data-pick="location"][data-val="gym"]');
    click('#onbNext');
    click('#onbNext');
    click('#onbNext');
    return store;
  }

  it('re-opens prefilled, keeps the plan by default, and an unchanged pass writes nothing', () => {
    const store = onboarded();
    const plan = store.getState().plan;
    const before = store.getEvents().length;
    click('[data-hub="SE"]');
    expect(q('#profileCard').textContent).toContain('הפרופיל שלי');
    expect(q('#profileCard').textContent).toContain('חיטוב');
    click('#btnProfileEdit');
    expect(q('#onb').getAttribute('data-mode')).toBe('edit');
    expect(q('#onbCancel').textContent).toBe('ביטול');
    for (let i = 0; i < 8; i++) click('#onbNext');
    expect(step()).toBe('8/8');
    expect(q('.onb-plan').textContent).toContain('להשאיר את התוכנית הנוכחית');
    expect((q('#onbUpdTargets') as HTMLInputElement).checked).toBe(false);
    expect(q('#onbNext').textContent).toBe('שמירה');
    click('#onbNext');
    expect(store.getEvents().length).toBe(before);
    expect(store.getState().plan).toEqual(plan);
    expect(store.getState().ui.view).toBe('ST');
    expect(q('#toast').textContent).toBe('הפרופיל נשמר ✅');
  });

  it('a changed answer + ticked targets: the profile and the targets, never a duplicate weigh-in, the plan kept', () => {
    const store = onboarded();
    const plan = store.getState().plan;
    const before = store.getEvents().length;
    click('[data-hub="SE"]');
    click('#btnProfileEdit');
    click('#onbNext');
    click('#onbNext');
    expect((q('#onbWeight') as HTMLInputElement).value).toBe('62');
    click('#onbNext');
    click('[data-pick="goal"][data-val="lose_fat"]');
    for (let i = 0; i < 5; i++) click('#onbNext');
    click('#onbUpdTargets');
    click('#onbNext');
    expect(types(store).slice(before)).toEqual(['profile_set', 'nutrition_targets_set']);
    expect(store.getState().profile?.goal).toBe('lose_fat');
    expect(weightEntries(store.getState().nutrition)).toHaveLength(1);
    expect(store.getState().plan).toEqual(plan);
  });
});
