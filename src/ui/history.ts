/**
 * ui/history.ts — the history screen: the game-event feed (see ui/feed.ts), the
 * logged-workout history, and JSON export / import / clear-all.
 *
 * Export writes the NEW blob shape (state + event log + a `sessions` mirror for
 * backwards compatibility), which already carries the `game` slot that Phase 1+
 * fills. Import accepts BOTH the new blob and the legacy `{sessions:{…}}` file.
 */

import { dayOf } from '../data/program.ts';
import { fmtDate, isSetFilled, todayISO } from '../core/workout.ts';
import { isDefaultPlan, makeResolver, resolveProgram } from '../core/plan.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { mergeImport } from '../storage/merge.ts';
import { buildExport, parseImport } from '../storage/migrate.ts';
import { bindAccountCard, renderAccountCard, type AccountDeps } from '../sync/account.ts';
import { esc, must } from './dom.ts';
import { renderFeed } from './feed.ts';
import { toast } from './toast.ts';

export interface HistoryDeps {
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

/**
 * The plan card — the history screen's entry point into the editor.
 *
 * It sits above the data actions because "what am I training" belongs with
 * export/import/clear: they are all things you do to your DATA, not during a
 * workout.
 */
function planCard(state: ReturnType<DataStore['getState']>): string {
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

export function renderHistory(main: HTMLElement, deps: HistoryDeps): void {
  const state = deps.store.getState();
  const dates = Object.keys(state.sessions).sort().reverse();
  const program = resolveProgram(state.plan);
  // History shows exercises BY ID, long after a plan may have changed — so it
  // resolves through the plan (customs included) and still tolerates an id that
  // resolves to nothing at all.
  const resolve = makeResolver(state.plan);

  let html = `
  <div class="data-actions">
    <button class="action-btn" id="btnExport">⬇ ייצוא JSON</button>
    <button class="action-btn" id="btnImport">⬆ ייבוא JSON</button>
    <button class="action-btn danger" id="btnClear">🗑 מחיקה</button>
  </div>
  ${deps.account ? renderAccountCard(deps.account) : ''}
  ${planCard(state)}
  ${renderFeed(deps.store.getEvents(), 40, resolve)}
  <h2 class="hist-heading">אימונים מתועדים</h2>`;

  const nonEmpty = dates.filter((d) => Object.keys(state.sessions[d]?.ex ?? {}).length > 0);
  if (nonEmpty.length === 0) {
    html += `<div class="empty">עדיין אין אימונים מתועדים.<br>סמנו סטים באחד מימי האימון והם יופיעו כאן. 💪</div>`;
  } else {
    html += nonEmpty
      .map((date) => {
        const s = state.sessions[date];
        if (!s) return '';
        // History is shown by DAY KEY, long after a plan may have dropped that
        // day — so it falls back to the first day's copy rather than vanishing.
        const p = dayOf(program, s.day) ?? program.days[0]?.day ?? null;
        const exHtml = Object.keys(s.ex)
          .map((exId) => {
            const exDef = resolve(exId);
            const sets = (s.ex[exId] ?? []).filter((x) => isSetFilled(x));
            if (!sets.length) return '';
            const setsTxt = sets
              .map((x) => `${x && x.w !== '' ? esc(x.w) : '–'}kg×${x && x.r !== '' ? esc(x.r) : '–'}${x && x.done ? '✓' : ''}`)
              .join('  |  ');
            return `<div class="hist-ex"><b>${esc(exDef ? exDef.he : exId)}</b><br><span class="hist-sets">${setsTxt}</span></div>`;
          })
          .join('');
        if (!exHtml) return '';
        const title = p ? ` · ${esc(p.label)} (יום ${esc(p.day)})` : '';
        return `<div class="hist-day">
        <h3>${fmtDate(date)}${title}</h3>
        <div class="sub">${p ? esc(p.focus) : ''}</div>
        ${exHtml}
      </div>`;
      })
      .join('');
  }

  main.innerHTML = html;
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

function bind(main: HTMLElement, deps: HistoryDeps): void {
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
