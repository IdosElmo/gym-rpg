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
 *   4. one quiet app-info line.
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
import { todayISO } from '../core/workout.ts';
import type { AppState, DataStore } from '../storage/DataStore.ts';
import { mergeImport } from '../storage/merge.ts';
import { buildExport, parseImport } from '../storage/migrate.ts';
import { bindAccountCard, renderAccountCard, type AccountDeps } from '../sync/account.ts';
import { esc, must } from './dom.ts';
import { toast } from './toast.ts';

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
}

/** The plan card — the settings screen's entry point into the editor. */
function planCard(state: AppState): string {
  const custom = !isDefaultPlan(state.plan);
  const program = resolveProgram(state.plan);
  const counts = program.days.map((d) => `${d.label}: ${d.day.exercises.length}`).join(' · ');
  return `
  <section class="game-card plan-card">
    <h3 class="gc-title">תוכנית האימונים
      <span class="gc-sub">${custom ? `מותאמת אישית · גרסה ${state.plan?.rev ?? 1}` : 'התוכנית המקורית'}</span>
    </h3>
    <p class="gc-note">${esc(counts)}</p>
    <button class="action-btn plan-card-btn" id="btnPlanEdit">⚙️ עריכת התוכנית</button>
  </section>`;
}

/** Export / import / clear — grouped so the destructive one is not a stray button. */
function dataCard(): string {
  return `
  <section class="game-card data-card">
    <h3 class="gc-title">הנתונים שלי <span class="gc-sub">גיבוי מקומי</span></h3>
    <p class="gc-note">כל הנתונים נשמרים במכשיר · ניתן לגבות ולשחזר כקובץ JSON</p>
    <div class="data-actions">
      <button class="action-btn" id="btnExport">⬇ ייצוא JSON</button>
      <button class="action-btn" id="btnImport">⬆ ייבוא JSON</button>
      <button class="action-btn danger" id="btnClear">🗑 מחיקה</button>
    </div>
  </section>`;
}

export function renderSettings(main: HTMLElement, deps: SettingsDeps): void {
  const state = deps.store.getState();
  main.innerHTML = `
  ${deps.account ? renderAccountCard(deps.account) : ''}
  ${planCard(state)}
  ${dataCard()}
  <p class="app-info">Gym RPG · גרסה ${esc(APP_VERSION)}<br>💪 האפליקציה עובדת 100% אופליין · הנתונים נשמרים במכשיר בלבד</p>`;
  bind(main, deps);
}

/**
 * Deleting means something DIFFERENT once there is an account behind the app.
 *
 * Locally it wipes this device. Signed in, the `data_cleared` event syncs like
 * every other event and every device folds it into a wipe — so the copy has to
 * say that out loud before the user taps it.
 */
export const CLEAR_CONFIRM_LOCAL = 'למחוק את כל היסטוריית האימונים? פעולה זו אינה הפיכה.';
export const CLEAR_CONFIRM_ACCOUNT =
  'למחוק את כל הנתונים מהחשבון ומכל המכשירים? פעולה זו אינה הפיכה.';

function bind(main: HTMLElement, deps: SettingsDeps): void {
  const { store, rerender } = deps;
  const fileInput = must('importFile') as HTMLInputElement;
  if (deps.account) bindAccountCard(main, deps.account);

  main.querySelector<HTMLButtonElement>('#btnExport')?.addEventListener('click', () => {
    exportJSON(store);
  });

  main.querySelector<HTMLButtonElement>('#btnImport')?.addEventListener('click', () => {
    fileInput.click();
  });

  main.querySelector<HTMLButtonElement>('#btnPlanEdit')?.addEventListener('click', () => {
    deps.editPlan?.();
  });

  main.querySelector<HTMLButtonElement>('#btnClear')?.addEventListener('click', () => {
    if (confirm(deps.isSignedIn?.() ? CLEAR_CONFIRM_ACCOUNT : CLEAR_CONFIRM_LOCAL)) {
      store.clear();
      rerender();
      toast('כל הנתונים נמחקו');
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
  toast('קובץ הגיבוי ירד למכשיר');
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
        toast('קובץ לא תקין — הייבוא בוטל');
        return;
      }
      if (deps.isSignedIn?.()) {
        const res = mergeImport(store, parsed);
        rerender();
        deps.onLocalMerge?.();
        toast(res.added > 0 ? `נוספו ${res.added} רשומות מהגיבוי ✓` : 'הגיבוי כבר קיים בחשבון');
        return;
      }
      store.replaceAll(parsed.state, parsed.events);
      store.append('data_imported', {
        source: parsed.source,
        sessions: parsed.state.sessions,
        sessionCount: Object.keys(parsed.state.sessions).length,
      });
      rerender();
      toast('הנתונים שוחזרו בהצלחה ✓');
    };
    rd.onerror = () => toast('קובץ לא תקין — הייבוא בוטל');
    rd.readAsText(f);
    target.value = '';
  });
}
