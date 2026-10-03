/**
 * ui/settings.ts — the הגדרות screen (view `ST`), first inner tab of the
 * settings hub.
 *
 * Everything you do to the APP rather than during a workout, top to bottom in
 * the order you are likely to want it:
 *
 *   1. the cloud/account card — "am I backed up, as whom" (see sync/account.ts);
 *   2. the plan card + ⚙️ — the second entry point into the plan editor;
 *   3. data actions — export / import / clear;
 *   4. the 🛠 dev panel — ONLY on the owner's session (see dev/gate.ts). For
 *      everybody else it is not rendered at all, so the screen above is
 *      byte-identical to what it has always been;
 *   5. one quiet app-info line.
 *
 * The workout LOG lives next door on the היסטוריה inner tab (ui/history.ts).
 * The split is the whole point of the hub: history is something you browse,
 * these are things you press, and mixing them made both harder to find.
 *
 * Export writes the NEW blob shape (state + event log + a `sessions` mirror for
 * backwards compatibility); import accepts BOTH that and the legacy
 * `{sessions:{…}}` file.
 */

import { isDefaultPlan, resolveProgram } from '../core/plan.ts';
import { needsPlanChoice } from '../core/profile.ts';
import { todayISO } from '../core/workout.ts';
import type { AppState, DataStore } from '../storage/DataStore.ts';
import { mergeImport } from '../storage/merge.ts';
import { buildExport, parseImport } from '../storage/migrate.ts';
import { bindAccountCard, renderAccountCard, type AccountDeps } from '../sync/account.ts';
import { bindDevPanel, devPanelCard, type DevPanelDeps } from './devPanel.ts';
import { esc, must } from './dom.ts';
import { toast } from './toast.ts';
import { LOCALES, LOCALE_NATIVE_NAME, isLocale, locale, tr } from '../i18n/locale.ts';
import { UNIT_SYSTEMS, isUnitSystem, units } from '../i18n/units.ts';
import { shell } from '../i18n/messages/shell.ts';
import { settings as M } from '../i18n/messages/settings.ts';
import { onboarding as OB } from '../i18n/messages/onboarding.ts';
import { DEFAULT_THEME, THEMES, isTheme, type Theme } from './theme.ts';
import { profileRows } from './onboarding.ts';

/**
 * Shown on the app-info line. Kept in sync with `package.json` by a test rather
 * than by a build-time define, so the single-file bundle stays a plain build
 * with nothing injected into it.
 */
export const APP_VERSION = '0.1.0';

export interface SettingsDeps {
  store: DataStore;
  rerender: () => void;
  /** Open the plan editor (the second entry point after the workout header). */
  editPlan?: () => void;
  /**
   * The cloud account, when this build has one. Absent (or reporting
   * `disabled`) means the offline app: no card, and the destructive
   * single-device semantics for clear + import.
   */
  account?: AccountDeps;
  /** True while a session is live — changes what מחיקה and ייבוא MEAN. */
  isSignedIn?: () => boolean;
  /** Called after an additive import, so the engine can upload what arrived. */
  onLocalMerge?: () => void;
  /**
   * The 🛠 dev panel, when this session passed the owner gate (`dev/gate.ts`).
   * Absent for everybody else, which is the whole feature: no card, no DOM, no
   * hint that there is one — the same rule the account card follows.
   */
  dev?: DevPanelDeps;
  /**
   * The 👤 profile card. `open` re-opens the questionnaire in its edit mode;
   * `offer` adds the quiet "complete your profile" card for a user with
   * history and no profile (only the real app sets it — see `AppHooks`).
   * Without a profile and without `offer` there is no card at all.
   */
  profile?: { open: () => void; offer: boolean };
  /** An EMPTY plan's plan card sends the user to the plan picker. */
  choosePlan?: () => void;
}

/** The plan card — the settings screen's entry point into the editor. */
function planCard(state: AppState): string {
  if (needsPlanChoice(state)) {
    const o = tr(OB).settings;
    return `
  <section class="game-card plan-card">
    <h3 class="gc-title">${tr(M).plan.title}
      <span class="gc-sub">${o.noPlanSub}</span>
    </h3>
    <p class="gc-note">${o.noPlanNote}</p>
    <button class="action-btn plan-card-btn" id="btnPlanChoose">${o.choosePlan}</button>
  </section>`;
  }
  const custom = !isDefaultPlan(state.plan);
  const program = resolveProgram(state.plan);
  const counts = program.days.map((d) => `${d.label}: ${d.day.exercises.length}`).join(' · ');
  const m = tr(M).plan;
  return `
  <section class="game-card plan-card">
    <h3 class="gc-title">${m.title}
      <span class="gc-sub">${custom ? m.custom(state.plan?.rev ?? 1) : m.original}</span>
    </h3>
    <p class="gc-note">${esc(counts)}</p>
    <button class="action-btn plan-card-btn" id="btnPlanEdit">${m.edit}</button>
  </section>`;
}

/** Export / import / clear — grouped so the destructive one is not a stray button. */
function dataCard(): string {
  const m = tr(M).data;
  return `
  <section class="game-card data-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub}</span></h3>
    <p class="gc-note">${m.note}</p>
    <div class="data-actions">
      <button class="action-btn" id="btnExport">${m.export}</button>
      <button class="action-btn" id="btnImport">${m.import}</button>
      <button class="action-btn danger" id="btnClear">${m.clear}</button>
    </div>
  </section>`;
}

/**
 * 🌐 Language & units — FIRST on the screen: someone who landed in a language
 * they cannot read has to find the way out without reading anything else, so
 * each language is offered in its own name.
 */
function prefsCard(theme: Theme): string {
  const m = tr(shell).prefs;
  const seg = (attr: string, value: string, label: string, on: boolean, lang?: string): string =>
    `<button class="seg-btn${on ? ' active' : ''}" data-${attr}="${value}" aria-pressed="${on}"${
      lang ? ` lang="${lang}"` : ''
    }>${esc(label)}</button>`;
  return `
  <section class="game-card prefs-card" id="prefsCard">
    <h3 class="gc-title">${m.title}</h3>
    <div class="prefs-row">
      <span class="prefs-label">${m.language}</span>
      <div class="seg" role="group" aria-label="${esc(m.language)}">${LOCALES.map((l) =>
        seg('locale', l, LOCALE_NATIVE_NAME[l], l === locale(), l),
      ).join('')}</div>
    </div>
    <div class="prefs-row">
      <span class="prefs-label">${m.appearance}</span>
      <div class="seg" role="group" aria-label="${esc(m.appearance)}">${THEMES.map((t) =>
        seg('look', t, m[t], t === theme),
      ).join('')}</div>
    </div>
    <div class="prefs-row">
      <span class="prefs-label">${m.units}</span>
      <div class="seg" role="group" aria-label="${esc(m.units)}">${UNIT_SYSTEMS.map((u) =>
        seg('units', u, m[u], u === units()),
      ).join('')}</div>
    </div>
    <p class="gc-note">${m.note}</p>
  </section>`;
}

/**
 * 👤 The questionnaire's answers, and the way back into it ("edit my answers",
 * which also recalculates the targets). A user with history and no profile —
 * the people the app was built for — gets a quiet offer instead. Nobody else
 * gets a card, so the screen stays what it was for a store without a profile.
 */
function profileCard(state: AppState, offer: boolean): string {
  const o = tr(OB).settings;
  if (state.profile === null) {
    if (!offer) return '';
    return `
  <section class="game-card profile-card" id="profileCard">
    <h3 class="gc-title">${o.completeTitle}</h3>
    <p class="gc-note">${o.completeNote}</p>
    <button class="action-btn" id="btnProfileEdit">${o.complete}</button>
  </section>`;
  }
  const rows = profileRows(state.profile, new Date().getFullYear());
  const body =
    rows.length === 0
      ? `<p class="gc-note">${o.skipped}</p>`
      : `<dl class="profile-rows">${rows
          .map(([k, v]) => `<div class="profile-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
          .join('')}</dl>`;
  return `
  <section class="game-card profile-card" id="profileCard">
    <h3 class="gc-title">${o.title}</h3>
    ${body}
    <button class="action-btn" id="btnProfileEdit">${rows.length === 0 ? o.complete : o.edit}</button>
    <p class="gc-note">${o.note}</p>
  </section>`;
}

export function renderSettings(main: HTMLElement, deps: SettingsDeps): void {
  const state = deps.store.getState();
  main.innerHTML = `
  ${prefsCard(state.ui.theme ?? DEFAULT_THEME)}${deps.profile ? profileCard(state, deps.profile.offer) : ''}
  ${deps.account ? renderAccountCard(deps.account) : ''}
  ${planCard(state)}
  ${dataCard()}
  ${deps.dev ? devPanelCard() : ''}
  <p class="app-info">${tr(M).info(esc(APP_VERSION))}</p>`;
  bind(main, deps);
}

/**
 * Deleting means something DIFFERENT once there is an account behind the app.
 *
 * Locally it wipes this device. Signed in, the `data_cleared` event syncs like
 * every other event and every device folds it into a wipe — so the copy has to
 * say that out loud before the user taps it.
 */
export const CLEAR_CONFIRM_LOCAL = M.he.clearConfirmLocal;
export const CLEAR_CONFIRM_ACCOUNT = M.he.clearConfirmAccount;

function bind(main: HTMLElement, deps: SettingsDeps): void {
  const { store, rerender } = deps;
  const fileInput = must('importFile') as HTMLInputElement;
  if (deps.account) bindAccountCard(main, deps.account);
  if (deps.dev) bindDevPanel(main, deps.dev);

  main.querySelectorAll<HTMLButtonElement>('#prefsCard [data-locale]').forEach((b) => {
    b.addEventListener('click', () => {
      const l = b.dataset['locale'];
      if (!isLocale(l) || l === store.getState().ui.locale) return;
      store.update((d) => {
        d.ui.locale = l;
      });
      rerender();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('#prefsCard [data-look]').forEach((b) => {
    b.addEventListener('click', () => {
      const t = b.dataset['look'];
      if (!isTheme(t) || t === (store.getState().ui.theme ?? DEFAULT_THEME)) return;
      store.update((d) => {
        d.ui.theme = t;
      });
      rerender();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('#prefsCard [data-units]').forEach((b) => {
    b.addEventListener('click', () => {
      const u = b.dataset['units'];
      if (!isUnitSystem(u) || u === store.getState().ui.units) return;
      store.update((d) => {
        d.ui.units = u;
      });
      rerender();
    });
  });

  main.querySelector<HTMLButtonElement>('#btnExport')?.addEventListener('click', () => {
    exportJSON(store);
  });

  main.querySelector<HTMLButtonElement>('#btnImport')?.addEventListener('click', () => {
    fileInput.click();
  });

  main.querySelector<HTMLButtonElement>('#btnPlanEdit')?.addEventListener('click', () => {
    deps.editPlan?.();
  });
  main.querySelector<HTMLButtonElement>('#btnPlanChoose')?.addEventListener('click', () => {
    deps.choosePlan?.();
  });
  main.querySelector<HTMLButtonElement>('#btnProfileEdit')?.addEventListener('click', () => {
    deps.profile?.open();
  });

  main.querySelector<HTMLButtonElement>('#btnClear')?.addEventListener('click', () => {
    const m = tr(M);
    if (confirm(deps.isSignedIn?.() ? m.clearConfirmAccount : m.clearConfirmLocal)) {
      store.clear();
      rerender();
      toast(tr(M).toast.cleared);
    }
  });
}

function exportJSON(store: DataStore): void {
  const blob = new Blob([JSON.stringify(buildExport(store.getState(), store.getEvents()), null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'workout-backup-' + todayISO() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast(tr(M).toast.exported);
}

export interface ImportDeps {
  /** True while a session is live — makes the import ADDITIVE instead of destructive. */
  isSignedIn?: () => boolean;
  /** Called after an additive import so the engine can upload what arrived. */
  onLocalMerge?: () => void;
}

/**
 * Wire the hidden <input type="file"> once, at boot.
 *
 * IMPORT MEANS TWO DIFFERENT THINGS, and which one is right depends entirely on
 * whether there is an account:
 *
 *  - SIGNED OUT it is a RESTORE. The file replaces what is on the device
 *    (`replaceAll`), because that is what restoring a backup means and there is
 *    nowhere else the data could live.
 *  - SIGNED IN it is a MERGE. The account already holds the union of every
 *    device; replacing the local log would push that truncated log outward and
 *    quietly delete history off the user's other phone. So the file's events are
 *    unioned in (`mergeImport`) and a `data_merged` marker records it.
 */
export function initImportInput(store: DataStore, rerender: () => void, deps: ImportDeps = {}): void {
  const input = must('importFile') as HTMLInputElement;
  input.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    const f = target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const parsed = parseImport(typeof rd.result === 'string' ? rd.result : '');
      if (!parsed) {
        toast(tr(M).toast.badFile);
        return;
      }
      if (deps.isSignedIn?.()) {
        const res = mergeImport(store, parsed);
        rerender();
        deps.onLocalMerge?.();
        toast(res.added > 0 ? tr(M).toast.merged(res.added) : tr(M).toast.alreadyThere);
        return;
      }
      store.replaceAll(parsed.state, parsed.events);
      store.append('data_imported', {
        source: parsed.source,
        sessions: parsed.state.sessions,
        sessionCount: Object.keys(parsed.state.sessions).length,
      });
      rerender();
      toast(tr(M).toast.restored);
    };
    rd.onerror = () => toast(tr(M).toast.badFile);
    rd.readAsText(f);
    target.value = '';
  });
}
