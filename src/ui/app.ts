/**
 * ui/app.ts — the app shell: tabs, header and screen switching.
 *
 * Tab order follows the brief: the three workout days, דמות, קרב, היסטוריה.
 * The tab list is data-driven, so a new screen only needs an entry plus a
 * render function.
 */

import { DAY_NAMES, DAY_ORDER, PROGRAM, isDayKey } from '../data/program.ts';
import { fmtDate, lastLoggedDate } from '../core/workout.ts';
import { gameOf } from '../core/game.ts';
import { worldById } from '../data/gameContent.ts';
import type { DataStore, ViewKey } from '../storage/DataStore.ts';
import type { RestTimer } from './timer.ts';
import { renderBattle, stopBattle } from './battle.ts';
import { renderCharacter } from './character.ts';
import { must } from './dom.ts';
import { renderHistory } from './history.ts';
import { renderWorkout } from './workout.ts';
import { fmtXp } from './xpfx.ts';

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
    const p = PROGRAM[view];
    const last = lastLoggedDate(state, view);
    headerEl.innerHTML = `
    <h1 class="app-title">יום ${p.day} · ${p.label} <span class="en">Hypertrophy</span></h1>
    <p class="day-meta"><b>${p.dur}</b> · ${p.focus}</p>
    <p class="last-log">אימון אחרון שתועד: <span class="val">${last ? fmtDate(last) : '— עדיין לא תועד'}</span></p>
    ${energyPill()}`;
  }

  function render(): void {
    // Battles run ONLY while the קרב tab is on screen — every render tears the
    // previous loop down before the new screen is mounted.
    stopBattle();
    renderTabs();
    renderHeader();
    const view = store.getState().ui.view;
    if (view === 'H') {
      renderHistory(mainEl, { store, rerender: render });
    } else if (view === 'CH') {
      renderCharacter(mainEl, { store });
    } else if (view === 'BT') {
      renderBattle(mainEl, { store, refreshHeader: renderHeader });
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
