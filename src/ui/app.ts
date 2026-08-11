/**
 * ui/app.ts — the app shell: the two-level nav, the header and screen switching.
 *
 * THE NAV IS TWO ROWS (see ui/nav.ts for the model):
 *
 *   * the HUB row — exactly three fixed, equal-width tabs, never scrolling:
 *     🏋️ אימון, 🎮 קרב, ⚙️ הגדרות. It is the same three tabs on every screen,
 *     so the thing you press to change context never moves under your thumb.
 *   * the INNER row — the tabs OF the active hub, at a lighter visual weight:
 *     the plan's workout occurrences for אימון (`scheduleTabs`, see
 *     core/plan.ts), קרב/דמות for the game, הגדרות/היסטוריה for settings.
 *     Only this row can ever scroll, and only when a plan defines more workout
 *     occurrences than fit.
 *
 * The active hub is DERIVED from `ui.view` (`hubOf`), never stored: the store
 * kept the exact view vocabulary it already had. What IS in memory is one
 * "last inner tab" per hub, so hopping to קרב and back returns you to the
 * workout you were doing rather than to the plan's default day.
 *
 * A training tab is an OCCURRENCE of a workout, not a workout: the built-in
 * program still shows its familiar three (its weekday map is a routing map),
 * while an A/B split trained Sun+Wed / Tue+Thu shows FOUR — ראשון, שלישי,
 * רביעי, חמישי — because that is the week the user actually trains.
 *
 * THE `@` STOPS HERE. An occurrence tab's view id is `dayKey@weekday`, and this
 * module is the only one that ever holds that string: `viewDayKey` strips it
 * before the workout screen, the header, the session lookup or any event sees a
 * day. Two tabs of the same workout therefore log into exactly the same session
 * and the same `set_*` payloads — no new event shape, no new session shape.
 *
 * PLAN EDITOR PLACEMENT (a Phase 4 decision that survives the redesign): `'PL'`
 * is a real view but NOT a tab. It belongs to the אימון hub and is reached from
 * the ⚙️ button in the workout header (where you notice you want to change
 * today's exercises) and from the plan card on the הגדרות screen (where the
 * other data actions live). Leaving it restores the view you came from.
 */

import { dayOf } from '../data/program.ts';
import { fmtDate, lastLoggedDate } from '../core/workout.ts';
import {
  defaultTabView,
  isDefaultPlan,
  resolveProgram,
  resolveTab,
  scheduleTabs,
  viewDayKey,
  type ScheduleTab,
} from '../core/plan.ts';
import { gameOf } from '../core/game.ts';
import { worldById } from '../data/gameContent.ts';
import type { DataStore, ViewKey } from '../storage/DataStore.ts';
import type { RestTimer } from './timer.ts';
import { renderBattle, stopBattle } from './battle.ts';
import { renderCharacter } from './character.ts';
import { esc, must } from './dom.ts';
import { renderHistory } from './history.ts';
import {
  GAME_TABS,
  HUBS,
  HUB_HOME,
  SETTINGS_TABS,
  hubOf,
  isRememberableInner,
  type HubId,
  type InnerTab,
} from './nav.ts';
import { renderPlanEditor, resetPlanDraft } from './planEditor.ts';
import { renderSettings, type SettingsDeps } from './settings.ts';
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
  settings?: Pick<SettingsDeps, 'account' | 'isSignedIn' | 'onLocalMerge'>;
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

  /** The screen the plan editor was opened from, so ← can return to it. */
  let returnView: ViewKey = store.getState().ui.view;

  /**
   * The inner tab each hub was last left on — the whole of "switching hubs
   * returns me where I was". In memory only: `ui.view` already persists the
   * hub you were in when the app closed, which is the part that has to survive
   * a reload, and remembering the other two hubs across days would be noise.
   */
  const lastInner: Record<HubId, ViewKey> = {
    TR: defaultTabView(store.getState().plan),
    GM: HUB_HOME.GM ?? 'BT',
    SE: HUB_HOME.SE ?? 'ST',
  };
  rememberInner(returnView);
  if (!isReturnable(returnView)) returnView = lastInner.TR;

  /** Record a view as its hub's last inner tab (the editor is never one). */
  function rememberInner(v: ViewKey): void {
    if (isRememberableInner(v)) lastInner[hubOf(v)] = v;
  }

  /** True for the five screens that are not a workout day. */
  function isScreen(v: ViewKey): boolean {
    return v === 'CH' || v === 'BT' || v === 'H' || v === 'PL' || v === 'ST';
  }

  /**
   * The TAB a day view is showing right now, or `null` when the plan has no
   * answer for it. This is also where a view stored in the older bare-day-key
   * form (`'A'`, `'d_alef'`) is canonicalised onto a real tab, so exactly one
   * tab lights up whichever shape the store happens to hold.
   */
  function currentTab(v: ViewKey): ScheduleTab | null {
    if (isScreen(v)) return null;
    return resolveTab(resolveProgram(store.getState().plan), v);
  }

  /**
   * A view key the app can actually render.
   *
   * A day key is only as real as the plan that defines it, and the plan can
   * change under a stored view: leaving the editor after picking a preset, or a
   * cloud pull that deleted a day on another device, both leave `ui.view`
   * pointing at a day that no longer exists. Rather than land the user on an
   * empty screen, an unknown view resolves to the plan's own default tab — the
   * same one the app boots on.
   */
  function resolveView(v: ViewKey): ViewKey {
    if (isScreen(v)) return v;
    const state = store.getState();
    return resolveTab(resolveProgram(state.plan), v)?.viewId ?? defaultTabView(state.plan);
  }

  function setView(view: ViewKey): void {
    const v = resolveView(view);
    const current = store.getState().ui.view;
    if (v === 'PL') {
      if (isReturnable(current)) returnView = current;
      // Always start the editor from what is actually saved — a draft left over
      // from a previous visit must never be mistaken for the stored plan.
      resetPlanDraft();
    }
    rememberInner(v);
    store.update((draft) => {
      draft.ui.view = v;
    });
    render();
  }

  /** Tap on a main tab: open that hub where it was last left. */
  function setHub(hub: HubId): void {
    setView(lastInner[hub]);
  }

  /**
   * Bring the active inner tab into view once its row scrolls.
   *
   * `scrollIntoView` is what gets RTL right (a hand-computed `scrollLeft` means
   * three different sign conventions across engines), and it is absent in jsdom
   * — hence the capability check rather than a call.
   */
  function revealActiveTab(): void {
    const row = tabsEl.querySelector<HTMLElement>('.sub-row.scroll');
    const active = row?.querySelector<HTMLElement>('.tab.active');
    if (!active || typeof active.scrollIntoView !== 'function') return;
    try {
      active.scrollIntoView({ block: 'nearest', inline: 'center' });
    } catch {
      /* older engines: the tab is simply left where it is */
    }
  }

  /**
   * The inner tabs of a hub.
   *
   * For אימון that is one tab per TRAINING OCCURRENCE the plan schedules
   * (`scheduleTabs`): the built-in program yields A/B/C with their weekday
   * names — the hard-wired list this used to be — and a real weekly schedule
   * yields one weekday-titled tab per session of the week.
   */
  function innerTabs(hub: HubId): readonly InnerTab[] {
    if (hub === 'GM') return GAME_TABS;
    if (hub === 'SE') return SETTINGS_TABS;
    return scheduleTabs(resolveProgram(store.getState().plan)).map((t) => ({
      viewId: t.viewId,
      title: t.title,
      subtitle: t.subtitle,
    }));
  }

  function renderTabs(): void {
    const view = store.getState().ui.view;
    const hub = hubOf(view);
    const tabs = innerTabs(hub);
    // Inside אימון the ACTIVE inner tab is the tab the day view canonicalises
    // to; the plan editor belongs to the hub but to none of its tabs, so none
    // of them lights up while it is open.
    const active = hub === 'TR' ? (currentTab(view)?.viewId ?? null) : view;
    const viewIds = new Set(tabs.map((t) => t.viewId));

    const hubRow = HUBS.map(
      (h) => `
      <button class="hub ${h.id === hub ? 'active' : ''}" data-hub="${h.id}"
        role="tab" aria-selected="${h.id === hub ? 'true' : 'false'}">
        <span class="h-icon" aria-hidden="true">${h.icon}</span><span class="h-label">${esc(h.title)}</span>
      </button>`,
    ).join('');

    const innerRow = tabs
      .map(
        (t) => `
      <button class="tab ${active === t.viewId ? 'active' : ''}" data-view="${esc(t.viewId)}"
        role="tab" aria-selected="${active === t.viewId ? 'true' : 'false'}"
        title="${esc(t.subtitle ? `${t.title} · ${t.subtitle}` : t.title)}">
        <span class="d">${esc(t.title)}</span>${t.subtitle ? `<span class="w">${esc(t.subtitle)}</span>` : ''}
      </button>`,
      )
      .join('');

    const hubLabel = HUBS.find((h) => h.id === hub)?.innerLabel ?? '';
    // Only the INNER row can ever scroll, and only past four tabs — a five- to
    // seven-day plan. The three main tabs are fixed, so the thing you press to
    // change context never moves.
    tabsEl.innerHTML = `
    <div class="hub-row" role="tablist" aria-label="ניווט ראשי">${hubRow}</div>
    <div class="sub-row ${tabs.length > 4 ? 'scroll' : ''}" role="tablist" aria-label="${esc(hubLabel)}">${innerRow}</div>`;

    tabsEl.querySelectorAll<HTMLButtonElement>('.hub').forEach((b) => {
      b.addEventListener('click', () => {
        const h = b.dataset['hub'];
        if (h === 'TR' || h === 'GM' || h === 'SE') setHub(h);
      });
    });
    tabsEl.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset['view'];
        if (v !== undefined && viewIds.has(v)) setView(v);
      });
    });
    revealActiveTab();
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
    if (view === 'ST') {
      headerEl.innerHTML = `<h1 class="app-title">הגדרות <span class="en">Settings</span></h1>
      <p class="day-meta">חשבון, תוכנית האימונים וניהול הנתונים</p>${energyPill()}`;
      return;
    }
    if (view === 'H') {
      headerEl.innerHTML = `<h1 class="app-title">היסטוריית אימונים <span class="en">History</span></h1>
      <p class="day-meta">כל אימון שתועד, והחדש ביותר למעלה</p>${energyPill()}`;
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
    const program = resolveProgram(state.plan);
    const dayKey = viewDayKey(view);
    // A day view whose key the plan no longer has (a day deleted on another
    // device) must still render a header rather than throw.
    const p = dayOf(program, dayKey) ?? program.days[0]?.day ?? null;
    if (!p) {
      headerEl.innerHTML = `<h1 class="app-title">אימון <span class="en">Workout</span></h1>${energyPill()}`;
      return;
    }
    // On an occurrence tab the title names THIS session of the week ("יום רביעי
    // · חלק א׳ …"); on a single-tab day the tab's title IS the day's caption, so
    // the line is byte-identical to what it has always been.
    const tab = currentTab(view);
    const caption = tab?.title ?? p.day;
    const name = tab?.subtitle ?? p.label;
    const last = lastLoggedDate(state, dayKey, program);
    headerEl.innerHTML = `
    <h1 class="app-title">יום ${esc(caption)} · ${esc(name)} <span class="en">Hypertrophy</span></h1>
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
    if (view === 'ST') {
      renderSettings(mainEl, { store, rerender: render, editPlan: () => setView('PL'), ...hooks.settings });
    } else if (view === 'H') {
      renderHistory(mainEl, { store });
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
      // The workout screen — and everything it writes — is keyed by the DAY.
      // The occurrence a tab stands for is a label, never data.
      renderWorkout(mainEl, viewDayKey(view), { store, timer, refreshHeader: renderHeader });
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
