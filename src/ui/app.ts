/**
 * ui/app.ts — the app shell: tabs, header and screen switching.
 *
 * Phase 1+ adds the דמות / קרב tabs here; the tab list is already data-driven
 * so a new screen only needs an entry plus a render function.
 */

import { DAY_NAMES, DAY_ORDER, PROGRAM, isDayKey } from '../data/program.ts';
import { fmtDate, lastLoggedDate } from '../core/workout.ts';
import type { DataStore, ViewKey } from '../storage/DataStore.ts';
import type { RestTimer } from './timer.ts';
import { must } from './dom.ts';
import { renderHistory } from './history.ts';
import { renderWorkout } from './workout.ts';

export interface App {
  render: () => void;
}

export function createApp(store: DataStore, timer: RestTimer): App {
  const tabsEl = must('tabs');
  const headerEl = must('header');
  const mainEl = must('main');

  function setView(v: ViewKey): void {
    store.update((draft) => {
      draft.ui.view = v;
    });
    render();
  }

  function renderTabs(): void {
    const view = store.getState().ui.view;
    tabsEl.innerHTML =
      DAY_ORDER.map(
        (k) => `
    <button class="tab ${view === k ? 'active' : ''}" data-view="${k}">
      <span class="d">${DAY_NAMES[k]}</span><span class="w">${PROGRAM[k].label}</span>
    </button>`,
      ).join('') +
      `<button class="tab hist-tab ${view === 'H' ? 'active' : ''}" data-view="H">
      <span class="d">🗓</span><span class="w">היסטוריה</span>
    </button>`;
    tabsEl.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset['view'];
        if (v === 'H' || isDayKey(v)) setView(v);
      });
    });
  }

  function renderHeader(): void {
    const state = store.getState();
    const view = state.ui.view;
    if (view === 'H') {
      headerEl.innerHTML = `<h1 class="app-title">היסטוריית אימונים <span class="en">History</span></h1>
      <p class="day-meta">כל הנתונים נשמרים במכשיר · ניתן לגבות ולשחזר כקובץ JSON</p>`;
      return;
    }
    const p = PROGRAM[view];
    const last = lastLoggedDate(state, view);
    headerEl.innerHTML = `
    <h1 class="app-title">יום ${p.day} · ${p.label} <span class="en">Hypertrophy</span></h1>
    <p class="day-meta"><b>${p.dur}</b> · ${p.focus}</p>
    <p class="last-log">אימון אחרון שתועד: <span class="val">${last ? fmtDate(last) : '— עדיין לא תועד'}</span></p>`;
  }

  function render(): void {
    renderTabs();
    renderHeader();
    const view = store.getState().ui.view;
    if (view === 'H') {
      renderHistory(mainEl, { store, rerender: render });
    } else {
      renderWorkout(mainEl, view, { store, timer, refreshHeader: renderHeader });
    }
    try {
      window.scrollTo(0, 0);
    } catch {
      /* non-browser host */
    }
  }

  return { render };
}
