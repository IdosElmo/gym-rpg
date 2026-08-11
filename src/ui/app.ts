/**
 * ui/app.ts — the app shell: tabs, header and screen switching.
 *
 * Tab order follows the brief: the three workout days, דמות, קרב, היסטוריה.
 * The tab list is data-driven, so a new screen only needs an entry plus a
 * render function.
 *
 * PLAN EDITOR PLACEMENT (a Phase 4 decision): `'PL'` is a real view but NOT a
 * seventh tab. Six tabs already fill the width of a phone; a seventh would make
 * the row unusable one-handed for the thing people actually do every day, which
 * is tapping their workout day. The editor is instead reached from a ⚙️ button
 * in the workout header (where you notice you want to change today's exercises)
 * and from a card on the היסטוריה screen (where the other data actions live).
 * Leaving it restores the view you came from.
 */

import { DAY_NAMES, DAY_ORDER, isDayKey } from '../data/program.ts';
import { fmtDate, lastLoggedDate } from '../core/workout.ts';
import { isDefaultPlan, resolveProgram } from '../core/plan.ts';
import { gameOf } from '../core/game.ts';
import { worldById } from '../data/gameContent.ts';
import type { DataStore, ViewKey } from '../storage/DataStore.ts';
import type { RestTimer } from './timer.ts';
import { renderBattle, stopBattle } from './battle.ts';
import { renderCharacter } from './character.ts';
import { must } from './dom.ts';
import { renderHistory, type HistoryDeps } from './history.ts';
import { renderPlanEditor, resetPlanDraft } from './planEditor.ts';
import { renderWorkout } from './workout.ts';
import { fmtXp } from './xpfx.ts';

export interface App {
  render: () => void;
}

/**
 * Optional composition-root hooks. They exist so `main.ts` can wire cloud sync
 * without this module importing anything sync-related: the shell stays the
 * offline shell it has always been, and everything cloudy arrives as data.
 */
export interface AppHooks {
  /** The account card + the signed-in meanings of מחיקה / ייבוא. */
  history?: Pick<HistoryDeps, 'account' | 'isSignedIn' | 'onLocalMerge'>;
  /** Fired at the end of every full render (lets main.ts clear a deferred repaint). */
  onRender?: () => void;
}

/** Views that are not the plan editor — where "close the editor" goes back to. */
function isReturnable(v: ViewKey): boolean {
  return v !== 'PL';
}

export function createApp(store: DataStore, timer: RestTimer, hooks: AppHooks = {}): App {
  const tabsEl = must('tabs');
  const headerEl = must('header');
  const mainEl = must('main');

  /** The screen the plan editor was opened from, so ✕ can return to it. */
  let returnView: ViewKey = store.getState().ui.view;
  if (!isReturnable(returnView)) returnView = 'H';

  function setView(v: ViewKey): void {
    const current = store.getState().ui.view;
    if (v === 'PL') {
      if (isReturnable(current)) returnView = current;
      // Always start the editor from what is actually saved — a draft left over
      // from a previous visit must never be mistaken for the stored plan.
      resetPlanDraft();
    }
    store.update((draft) => {
      draft.ui.view = v;
    });
    render();
  }

  function renderTabs(): void {
    const view = store.getState().ui.view;
    const program = resolveProgram(store.getState().plan);
    tabsEl.innerHTML =
      DAY_ORDER.map(
        (k) => `
    <button class="tab ${view === k ? 'active' : ''}" data-view="${k}">
      <span class="d">${DAY_NAMES[k]}</span><span class="w">${program[k].label}</span>
    </button>`,
      ).join('') +
      `<button class="tab char-tab ${view === 'CH' ? 'active' : ''}" data-view="CH">
      <span class="d">🦸</span><span class="w">דמות</span>
    </button>` +
      `<button class="tab battle-tab ${view === 'BT' ? 'active' : ''}" data-view="BT">
      <span class="d">🎮</span><span class="w">קרב</span>
    </button>` +
      `<button class="tab hist-tab ${view === 'H' ? 'active' : ''}" data-view="H">
      <span class="d">🗓</span><span class="w">היסטוריה</span>
    </button>`;
    tabsEl.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset['view'];
        if (v === 'H' || v === 'CH' || v === 'BT' || isDayKey(v)) setView(v);
      });
    });
  }

  /** Battle energy lives in the header corner on every screen — small and quiet. */
  function energyPill(): string {
    const game = gameOf(store);
    return `<div class="energy-pill" title="אנרגיית קרב — נצברת מאימונים אמיתיים">
      ⚡<span class="ep-num">${fmtXp(game.energy)}</span>
    </div>`;
  }

  function renderHeader(): void {
    const state = store.getState();
    const view = state.ui.view;
    if (view === 'H') {
      headerEl.innerHTML = `<h1 class="app-title">היסטוריית אימונים <span class="en">History</span></h1>
      <p class="day-meta">כל הנתונים נשמרים במכשיר · ניתן לגבות ולשחזר כקובץ JSON</p>${energyPill()}`;
      return;
    }
    if (view === 'PL') {
      const custom = !isDefaultPlan(state.plan);
      headerEl.innerHTML = `<h1 class="app-title">עריכת תוכנית <span class="en">Plan</span></h1>
      <p class="day-meta">${custom ? 'תוכנית מותאמת אישית' : 'התוכנית המקורית'} · שינויים נשמרים רק בלחיצה על 💾</p>
      <button class="plan-back" id="btnPlanBack">← חזרה</button>`;
      headerEl.querySelector<HTMLButtonElement>('#btnPlanBack')?.addEventListener('click', () => {
        setView(returnView);
      });
      return;
    }
    if (view === 'CH') {
      const game = gameOf(store);
      headerEl.innerHTML = `<h1 class="app-title">הדמות שלי <span class="en">Character</span></h1>
      <p class="day-meta">רמה <b>${game.level}</b> · כל סט אמיתי מחזק חלק אחר בגוף</p>${energyPill()}`;
      return;
    }
    if (view === 'BT') {
      const game = gameOf(store);
      const world = worldById(game.battle.world);
      headerEl.innerHTML = `<h1 class="app-title">מצב קרב <span class="en">Battle</span></h1>
      <p class="day-meta">${world.he} · גל <b>${game.battle.wave}</b> · רמה <b>${game.level}</b></p>${energyPill()}`;
      return;
    }
    const p = resolveProgram(state.plan)[view];
    const last = lastLoggedDate(state, view, resolveProgram(state.plan));
    headerEl.innerHTML = `
    <h1 class="app-title">יום ${p.day} · ${p.label} <span class="en">Hypertrophy</span></h1>
    <p class="day-meta"><b>${p.dur}</b> · ${p.focus}</p>
    <p class="last-log">אימון אחרון שתועד: <span class="val">${last ? fmtDate(last) : '— עדיין לא תועד'}</span></p>
    <button class="plan-edit-btn" id="btnEditPlan" aria-label="עריכת תוכנית האימונים">⚙️ עריכת תוכנית</button>
    ${energyPill()}`;
    headerEl.querySelector<HTMLButtonElement>('#btnEditPlan')?.addEventListener('click', () => setView('PL'));
  }

  /** Rebuild the arena in place (a world boss fell — the whole world changed). */
  function renderBattleScreen(): void {
    if (store.getState().ui.view !== 'BT') return;
    renderHeader();
    renderBattle(mainEl, { store, refreshHeader: renderHeader, remount: renderBattleScreen });
  }

  function renderCharacterScreen(): void {
    renderHeader();
    renderCharacter(mainEl, { store, rerender: renderCharacterScreen });
  }

  /** Re-render the editor in place (draft edits must not reset the scroll). */
  function renderPlanScreen(): void {
    if (store.getState().ui.view !== 'PL') return;
    renderHeader();
    renderPlanEditor(mainEl, { store, rerender: renderPlanScreen, close: () => setView(returnView) });
  }

  function render(): void {
    // Battles run ONLY while the קרב tab is on screen — every render tears the
    // previous loop down before the new screen is mounted.
    stopBattle();
    renderTabs();
    renderHeader();
    const view = store.getState().ui.view;
    if (view === 'H') {
      renderHistory(mainEl, { store, rerender: render, editPlan: () => setView('PL'), ...hooks.history });
    } else if (view === 'PL') {
      renderPlanEditor(mainEl, { store, rerender: renderPlanScreen, close: () => setView(returnView) });
    } else if (view === 'CH') {
      // A shop purchase re-renders the דמות screen in place (header + main, no
      // scroll reset) so the character, the stat grid and the purse update
      // without throwing the player back to the top of the page.
      renderCharacter(mainEl, { store, rerender: renderCharacterScreen });
    } else if (view === 'BT') {
      renderBattle(mainEl, { store, refreshHeader: renderHeader, remount: renderBattleScreen });
    } else {
      renderWorkout(mainEl, view, { store, timer, refreshHeader: renderHeader });
    }
    try {
      window.scrollTo(0, 0);
    } catch {
      /* non-browser host */
    }
    // Anything the screen was showing is now freshly derived from the store, so
    // a repaint that sync deferred (see main.ts) has just been satisfied.
    hooks.onRender?.();
  }

  return { render };
}
