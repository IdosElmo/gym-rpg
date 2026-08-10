/**
 * ui/history.ts — the history screen: the game-event feed (see ui/feed.ts), the
 * logged-workout history, and JSON export / import / clear-all.
 *
 * Export writes the NEW blob shape (state + event log + a `sessions` mirror for
 * backwards compatibility), which already carries the `game` slot that Phase 1+
 * fills. Import accepts BOTH the new blob and the legacy `{sessions:{…}}` file.
 */

import { DAY_ORDER, isDayKey } from '../data/program.ts';
import { fmtDate, isSetFilled, todayISO } from '../core/workout.ts';
import { isDefaultPlan, makeResolver, resolveProgram } from '../core/plan.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { buildExport, parseImport } from '../storage/migrate.ts';
import { esc, must } from './dom.ts';
import { renderFeed } from './feed.ts';
import { toast } from './toast.ts';

export interface HistoryDeps {
  store: DataStore;
  rerender: () => void;
  /** Open the plan editor (the second entry point after the workout header). */
  editPlan?: () => void;
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
  const counts = DAY_ORDER.map((k) => `${program[k].label}: ${program[k].exercises.length}`).join(' · ');
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
        const p = isDayKey(s.day) ? program[s.day] : program.A;
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
        return `<div class="hist-day">
        <h3>${fmtDate(date)} · ${esc(p.label)} (יום ${esc(p.day)})</h3>
        <div class="sub">${esc(p.focus)}</div>
        ${exHtml}
      </div>`;
      })
      .join('');
  }

  main.innerHTML = html;
  bind(main, deps);
}

function bind(main: HTMLElement, deps: HistoryDeps): void {
  const { store, rerender } = deps;
  const fileInput = must('importFile') as HTMLInputElement;

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
    if (confirm('למחוק את כל היסטוריית האימונים? פעולה זו אינה הפיכה.')) {
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

/** Wire the hidden <input type="file"> once, at boot. */
export function initImportInput(store: DataStore, rerender: () => void): void {
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
