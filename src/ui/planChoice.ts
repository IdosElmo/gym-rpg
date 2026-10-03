/**
 * ui/planChoice.ts — the training hub of a user who has NO plan yet.
 *
 * `needsPlanChoice` (core/profile.ts): the questionnaire was answered or
 * skipped, no plan was chosen and nothing was trained. For everybody else
 * `plan === null` means "the built-in program"; for this user it means
 * "nothing yet", so the 🏋️ hub shows no day tabs and this screen instead of
 * somebody else's A/B/C:
 *
 *   - the recommended preset (`recommendPreset`) as a big card with one
 *     primary button — build it, lay it on the user's weekdays, save it, and
 *     land on its first workout;
 *   - the other presets as smaller cards;
 *   - "build my own" → the plan editor, starting from ONE empty day (a plan may
 *     not have zero days, see `PLAN_LIMITS.minDays`).
 */

import { savePlan } from '../core/plan.ts';
import { onWeekdays, recommendPreset } from '../core/profile.ts';
import { PLAN_PRESETS, presetById, type PlanPreset } from '../data/presets.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { tr } from '../i18n/locale.ts';
import { weekdayName, weekdayOrder } from '../i18n/format.ts';
import { onboarding as O } from '../i18n/messages/onboarding.ts';
import { esc } from './dom.ts';
import { icon } from './icons.ts';
import { toast } from './toast.ts';

export interface PlanChoiceDeps {
  store: DataStore;
  /** A plan was saved: go to its workout. */
  started: () => void;
  /** Open the plan editor on an empty day. */
  build: () => void;
}

function weekdaysLine(days: readonly number[]): string {
  const set = new Set(days);
  return weekdayOrder()
    .filter((wd) => set.has(wd))
    .map((wd) => weekdayName(wd))
    .join(' · ');
}

/** Save `preset` as the user's plan, on their own weekdays when they gave some. */
export function startPreset(store: DataStore, presetId: string, now: number = Date.now()): PlanPreset | null {
  const preset = presetById(presetId);
  if (!preset) return null;
  const weekdays = store.getState().profile?.weekdays;
  const doc = weekdays && weekdays.length > 0 ? onWeekdays(preset.build(), weekdays) : preset.build();
  const res = savePlan(store, doc, now);
  return res.ok ? preset : null;
}

export function renderPlanChoice(main: HTMLElement, deps: PlanChoiceDeps): void {
  const C = tr(O).choice;
  const profile = deps.store.getState().profile ?? {};
  const rec = recommendPreset(profile, PLAN_PRESETS.map((p) => p.id));
  const top = presetById(rec.id);
  const days = profile.weekdays && profile.weekdays.length > 0 ? weekdaysLine(profile.weekdays) : '';
  const others = rec.alternatives.map((id) => presetById(id)).filter((p): p is PlanPreset => p !== null);

  main.innerHTML = `
  <section class="pc" id="planChoice">
    <div class="pc-intro">
      <span class="pc-mark">${icon('calendar')}</span>
      <h2 class="pc-title">${esc(C.title)}</h2>
      <p class="pc-sub">${esc(C.sub)}</p>
    </div>
    ${
      top
        ? `<article class="pc-card pc-main">
      <span class="onb-badge">${icon('spark')}${esc(C.recommended)}</span>
      <h3 class="pc-name">${esc(top.name)}</h3>
      <p class="pc-desc">${esc(top.description)}</p>
      ${days ? `<p class="pc-days">${icon('calendar')}${esc(days)}</p>` : ''}
      <button type="button" class="onb-cta pc-start" data-start="${esc(top.id)}">${esc(C.start)}</button>
    </article>`
        : ''
    }
    ${
      others.length > 0
        ? `<h3 class="pc-h">${esc(C.others)}</h3>
    ${others
      .map(
        (p) => `<article class="pc-card pc-alt">
      <div class="pc-alt-tx"><b>${esc(p.name)}</b><small>${esc(p.description)}</small></div>
      <button type="button" class="pc-pick" data-start="${esc(p.id)}">${esc(C.pick)}</button>
    </article>`,
      )
      .join('')}`
        : ''
    }
    <button type="button" class="pc-card pc-build" id="pcBuild">
      <span class="onb-oic">${icon('plus')}</span>
      <span class="onb-tx"><b>${esc(C.build)}</b><small>${esc(C.buildNote)}</small></span>
      ${icon('chevron', 'pc-chev')}
    </button>
  </section>`;

  main.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((b) => {
    b.addEventListener('click', () => {
      const preset = startPreset(deps.store, b.dataset['start'] ?? '');
      if (!preset) return;
      toast(tr(O).toast.planStarted(preset.name));
      deps.started();
    });
  });
  main.querySelector('#pcBuild')?.addEventListener('click', () => deps.build());
}
