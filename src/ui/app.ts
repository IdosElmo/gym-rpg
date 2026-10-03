/**
 * ui/app.ts — the app shell: the two-level nav, the header and screen switching.
 *
 * THE NAV IS TWO ROWS (see ui/nav.ts for the model):
 *
 *   * the HUB row — exactly four fixed, equal-width tabs, never scrolling:
 *     🏋️ אימון, 🎮 קרב, 🍽️ תזונה, ⚙️ הגדרות. It is the same four tabs on every
 *     screen, so the thing you press to change context never moves under your
 *     thumb.
 *   * the INNER row — the tabs OF the active hub, at a lighter visual weight:
 *     the plan's workout occurrences for אימון (`scheduleTabs`, see
 *     core/plan.ts), קרב/דמות/🏆 ליגה for the game, 🍽️ תזונה for nutrition,
 *     הגדרות/היסטוריה/📊 סטטיסטיקות for settings.
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
import { fmtDate, lastLoggedDate, todayISO } from '../core/workout.ts';
import { dayTotals } from '../core/nutrition.ts';
import type { NutritionAiPort } from '../nutrition/aiPort.ts';
import type { PushPort } from '../nutrition/push.ts';
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
import { needsOnboarding, needsPlanChoice } from '../core/profile.ts';
import { blankPlanDoc } from '../core/onboarding.ts';
import { worldById } from '../data/gameContent.ts';
import type { DataStore, ViewKey } from '../storage/DataStore.ts';
import type { RestTimer } from './timer.ts';
import { renderBattle, stopBattle } from './battle.ts';
import type { GhostDuelDeps } from './ghost.ts';
import { exitCharacterPreview, renderCharacter } from './character.ts';
import { esc, must } from './dom.ts';
import { renderHistory } from './history.ts';
import { captureRivalInvite, renderLeague, type LeagueCloudDeps } from './league.ts';
import { prizeModeOf } from '../core/league.ts';
import {
  GAME_TABS,
  HUBS,
  HUB_HOME,
  NUTRITION_TABS,
  SETTINGS_TABS,
  hubOf,
  isRememberableInner,
  type HubId,
  type InnerTab,
} from './nav.ts';
import { renderNutrition } from './nutrition.ts';
import { renderWeight, weightHeadline } from './weight.ts';
import { photosHeadline, renderPhotos, type PhotosDeps } from './photos.ts';
import { MemoryBlobStore } from '../storage/MemoryBlobStore.ts';
import { renderPlanEditor, resetPlanDraft } from './planEditor.ts';
import { closeOnboarding, isOnboardingOpen, openOnboarding, renderOnboarding, type OnboardingOutcome } from './onboarding.ts';
import { renderPlanChoice } from './planChoice.ts';
import { toast } from './toast.ts';
import { renderSettings, type SettingsDeps } from './settings.ts';
import { renderStats } from './stats.ts';
import { renderWorkout } from './workout.ts';
import { fmtXp } from './xpfx.ts';
import { DEFAULT_LOCALE, dirOf, pick, setLocale, tr } from '../i18n/locale.ts';
import { setUnits } from '../i18n/units.ts';
import { shell } from '../i18n/messages/shell.ts';
import { onboarding as OB } from '../i18n/messages/onboarding.ts';
import { plan as PM } from '../i18n/messages/plan.ts';
import { DEFAULT_THEME, THEME_CHROME } from './theme.ts';

/**
 * Point the language and units module state at this device's preferences and
 * make the document agree: `lang`/`dir` on <html> (which flips every logical
 * CSS property and the text direction at once), `data-theme` (which swaps every
 * colour token, see styles/tokens.css) and the browser chrome colour, the tab title, and the few
 * strings index.html ships as static markup. Called at the top of EVERY full
 * render, so a language switch is simply "save the preference, render".
 */
export function applyPrefs(store: DataStore): void {
  const ui = store.getState().ui;
  const loc = ui.locale ?? DEFAULT_LOCALE;
  setLocale(loc);
  setUnits(ui.units ?? 'metric');
  const root = document.documentElement;
  const theme = ui.theme ?? DEFAULT_THEME;
  if (root.getAttribute('data-theme') !== theme) root.setAttribute('data-theme', theme);
  const chrome = document.querySelector('meta[name="theme-color"]');
  if (chrome && chrome.getAttribute('content') !== THEME_CHROME[theme]) chrome.setAttribute('content', THEME_CHROME[theme]);
  if (root.getAttribute('lang') !== loc) root.setAttribute('lang', loc);
  if (root.getAttribute('dir') !== dirOf(loc)) root.setAttribute('dir', dirOf(loc));
  const s = tr(shell);
  if (document.title !== s.doc.title) document.title = s.doc.title;
  const setText = (sel: string, text: string): void => {
    const el = document.querySelector(sel);
    if (el && el.textContent !== text) el.textContent = text;
  };
  setText('body > footer', s.doc.footer);
  const bar = document.getElementById('timerBar');
  if (bar && bar.getAttribute('dir') !== dirOf(loc)) bar.setAttribute('dir', dirOf(loc));
  setText('#tReset', s.timer.reset);
  document.getElementById('tClose')?.setAttribute('aria-label', s.timer.close);
}

/** "<h1>title <span class="en">sub</span></h1>" — the subtitle only when the locale has one. */
function titleHtml(title: string, sub: string): string {
  return `<h1 class="app-title">${title}${sub ? ` <span class="en">${sub}</span>` : ''}</h1>`;
}

export interface App {
  render: () => void;
}

/**
 * Optional composition-root hooks. They exist so `main.ts` can wire cloud sync
 * without this module importing anything sync-related: the shell stays the
 * offline shell it has always been, and everything cloudy arrives as data.
 */
export interface AppHooks {
  /**
   * The account card, the signed-in meanings of מחיקה / ייבוא — and the 🛠 dev
   * panel, which `main.ts` supplies only for the owner's session.
   */
  settings?: Pick<SettingsDeps, 'account' | 'isSignedIn' | 'onLocalMerge' | 'dev'>;
  /**
   * The ghost-duel plumbing for the קרב screen. Absent = the duel card is not
   * rendered at all, which is the offline app's normal state.
   */
  ghost?: GhostDuelDeps;
  /**
   * The cloud half of 🏆 הליגה — the rival's month. Absent = the race section is
   * not rendered at all; the rest of the league screen (my week, the shop, the
   * history) is local and works offline either way.
   */
  league?: LeagueCloudDeps;
  /**
   * The Gemini calorie-estimation port for the 🍽️ תזונה screen. Absent = the
   * ✨ estimate button is not rendered at all — the offline app's normal state;
   * manual logging works identically either way.
   */
  nutrition?: { ai: NutritionAiPort; push?: PushPort };
  /**
   * The 📸 photos screen's plumbing: where the bytes live, and (tests only)
   * how a picked file becomes a stored image. Absent = an in-memory store,
   * so the screen still works and photos last until reload.
   */
  photos?: Pick<PhotosDeps, 'blobs' | 'prepare' | 'camera'>;
  /** Fired at the end of every full render (lets main.ts clear a deferred repaint). */
  onRender?: () => void;
  /**
   * Greet a FRESH install with the opening questionnaire (ui/onboarding.ts)
   * and offer the 👤 "complete your profile" card to users with history.
   * Only `main.ts` sets it: a shell created without it (every older test)
   * renders exactly the app it always has.
   */
  onboarding?: boolean;
}

/** Views that are not the plan editor — where "close the editor" goes back to. */
function isReturnable(v: ViewKey): boolean {
  return v !== 'PL';
}

export function createApp(store: DataStore, timer: RestTimer, hooks: AppHooks = {}): App {
  const tabsEl = must('tabs');
  const headerEl = must('header');
  const mainEl = must('main');

  // 🏆 The league's prize mode is pinned the first time this version boots:
  // an install that already has a league past keeps the couple's pools, a
  // fresh one starts on personal prizes and stays there as its history grows
  // (`prizeModeOf`). A device preference — never an event.
  if (store.getState().ui.prizes === undefined) {
    const prizes = prizeModeOf(store.getState());
    store.update((d) => {
      d.ui.prizes = prizes;
    });
  }
  // A new shell starts with no questionnaire in progress (its answers are
  // module state, and a previous shell's half-answered session is not ours).
  closeOnboarding();

  // Opened from an invitation link (`#rival=<handle>`): straight to 🏆 ליגה,
  // which asks before anything is decided. The hash leaves the address bar.
  captureRivalInvite(store, window);

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
    NU: HUB_HOME.NU ?? 'NT',
    SE: HUB_HOME.SE ?? 'ST',
  };
  rememberInner(returnView);
  if (!isReturnable(returnView)) returnView = lastInner.TR;

  /** Record a view as its hub's last inner tab (the editor is never one). */
  function rememberInner(v: ViewKey): void {
    if (isRememberableInner(v)) lastInner[hubOf(v)] = v;
  }

  /** True for the nine screens that are not a workout day. */
  function isScreen(v: ViewKey): boolean {
    return (
      v === 'CH' ||
      v === 'BT' ||
      v === 'H' ||
      v === 'PL' ||
      v === 'ST' ||
      v === 'SS' ||
      v === 'LG' ||
      v === 'NT' ||
      v === 'WT' ||
      v === 'PH'
    );
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
      // from a previous visit must never be mistaken for the stored plan. An
      // EMPTY plan has nothing saved: the editor starts from one empty day.
      const state = store.getState();
      resetPlanDraft(needsPlanChoice(state) ? blankPlanDoc(tr(PM).newDayLabel, state.profile?.weekdays ?? []) : null);
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
    const names = tr(shell).nav.tabs;
    const named = (list: readonly InnerTab[]): InnerTab[] =>
      list.map((t) => ({ ...t, title: names[t.viewId as keyof typeof names] ?? t.title }));
    if (hub === 'GM') return named(GAME_TABS);
    if (hub === 'NU') return named(NUTRITION_TABS);
    if (hub === 'SE') return named(SETTINGS_TABS);
    // An EMPTY plan has no workouts to tab between: the hub is the plan picker.
    if (needsPlanChoice(store.getState())) return [];
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
        <span class="h-icon" aria-hidden="true">${h.icon}</span><span class="h-label">${esc(tr(shell).nav.hubs[h.id].title)}</span>
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

    const hubLabel = tr(shell).nav.hubs[hub].inner;
    // Only the INNER row can ever scroll, and only past four tabs — a five- to
    // seven-day plan. The four main tabs are fixed, so the thing you press to
    // change context never moves.
    tabsEl.innerHTML = `
    <div class="hub-row" role="tablist" aria-label="${esc(tr(shell).nav.mainLabel)}">${hubRow}</div>${
      tabs.length === 0
        ? ''
        : `
    <div class="sub-row ${tabs.length > 4 ? 'scroll' : ''}" role="tablist" aria-label="${esc(hubLabel)}">${innerRow}</div>`
    }`;

    tabsEl.querySelectorAll<HTMLButtonElement>('.hub').forEach((b) => {
      b.addEventListener('click', () => {
        const h = b.dataset['hub'];
        if (h === 'TR' || h === 'GM' || h === 'NU' || h === 'SE') setHub(h);
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
    return `<div class="energy-pill" title="${esc(tr(shell).header.energyTitle)}">
      ⚡<span class="ep-num">${fmtXp(game.energy)}</span>
    </div>`;
  }

  function renderHeader(): void {
    const state = store.getState();
    const view = state.ui.view;
    const H = tr(shell).header;
    if (view === 'ST') {
      headerEl.innerHTML = `${titleHtml(H.ST.title, H.ST.sub)}
      <p class="day-meta">${H.ST.meta}</p>${energyPill()}`;
      return;
    }
    if (view === 'H') {
      headerEl.innerHTML = `${titleHtml(H.H.title, H.H.sub)}
      <p class="day-meta">${H.H.meta}</p>${energyPill()}`;
      return;
    }
    if (view === 'SS') {
      headerEl.innerHTML = `${titleHtml(H.SS.title, H.SS.sub)}
      <p class="day-meta">${H.SS.meta}</p>${energyPill()}`;
      return;
    }
    if (view === 'NT') {
      const totals = dayTotals(state.nutrition, todayISO());
      headerEl.innerHTML = `${titleHtml(H.NT.title, H.NT.sub)}
      <p class="day-meta">${H.NT.meta(`<b>${totals.calories}</b>`, `<b>${totals.protein}</b>`)}</p>${energyPill()}`;
      return;
    }
    if (view === 'WT') {
      headerEl.innerHTML = `${titleHtml(H.WT.title, H.WT.sub)}
      <p class="day-meta">${esc(weightHeadline(state.nutrition))}</p>${energyPill()}`;
      return;
    }
    if (view === 'PH') {
      headerEl.innerHTML = `${titleHtml(H.PH.title, H.PH.sub)}
      <p class="day-meta">${esc(photosHeadline(state.nutrition))}</p>${energyPill()}`;
      return;
    }
    if (view === 'PL') {
      const custom = !isDefaultPlan(state.plan);
      const which = needsPlanChoice(state) ? tr(OB).choice.headTitle : custom ? H.PL.custom : H.PL.original;
      headerEl.innerHTML = `${titleHtml(H.PL.title, H.PL.sub)}
      <p class="day-meta">${which} · ${H.PL.saveHint}</p>
      <button class="plan-back" id="btnPlanBack">${H.PL.back}</button>`;
      headerEl.querySelector<HTMLButtonElement>('#btnPlanBack')?.addEventListener('click', () => {
        setView(returnView);
      });
      return;
    }
    if (view === 'CH') {
      const game = gameOf(store);
      headerEl.innerHTML = `${titleHtml(H.CH.title, H.CH.sub)}
      <p class="day-meta">${H.CH.meta(`<b>${game.level}</b>`)}</p>${energyPill()}`;
      return;
    }
    if (view === 'LG') {
      const game = gameOf(store);
      headerEl.innerHTML = `${titleHtml(H.LG.title, H.LG.sub)}
      <p class="day-meta">${H.LG.meta(`<b>${game.league.coins}</b>`)}</p>${energyPill()}`;
      return;
    }
    if (view === 'BT') {
      const game = gameOf(store);
      const world = worldById(game.battle.world);
      headerEl.innerHTML = `${titleHtml(H.BT.title, H.BT.sub)}
      <p class="day-meta">${H.BT.meta(pick(world), `<b>${game.battle.wave}</b>`, `<b>${game.level}</b>`)}</p>${energyPill()}`;
      return;
    }
    if (needsPlanChoice(state)) {
      const C = tr(OB).choice;
      headerEl.innerHTML = `${titleHtml(esc(C.headTitle), esc(C.headSub))}
      <p class="day-meta">${esc(C.headMeta)}</p>${energyPill()}`;
      return;
    }
    const program = resolveProgram(state.plan);
    const dayKey = viewDayKey(view);
    // A day view whose key the plan no longer has (a day deleted on another
    // device) must still render a header rather than throw.
    const raw = dayOf(program, dayKey) ?? program.days[0]?.day ?? null;
    if (!raw) {
      headerEl.innerHTML = `${titleHtml(H.workout.fallbackTitle, H.workout.fallbackSub)}${energyPill()}`;
      return;
    }
    // `resolveProgram` already hands back the day in the reader's language.
    const p = raw;
    // On an occurrence tab the title names THIS session of the week ("יום רביעי
    // · חלק א׳ …"); on a single-tab day the tab's title IS the day's caption, so
    // the line is byte-identical to what it has always been.
    const tab = currentTab(view);
    const caption = tab?.title ?? p.day;
    const name = tab?.subtitle ?? p.label;
    const last = lastLoggedDate(state, dayKey, program);
    headerEl.innerHTML = `
    ${titleHtml(H.workout.title(esc(caption), esc(name)), H.workout.sub)}
    <p class="day-meta"><b>${p.dur}</b> · ${p.focus}</p>
    <p class="last-log">${H.workout.lastLogged} <span class="val">${last ? fmtDate(last) : H.workout.never}</span></p>
    <button class="plan-edit-btn" id="btnEditPlan" aria-label="${esc(H.workout.editPlanLabel)}">${H.workout.editPlan}</button>
    ${energyPill()}`;
    headerEl.querySelector<HTMLButtonElement>('#btnEditPlan')?.addEventListener('click', () => setView('PL'));
  }

  /** Rebuild the arena in place (a world boss fell — the whole world changed). */
  function renderBattleScreen(): void {
    if (store.getState().ui.view !== 'BT') return;
    renderHeader();
    renderBattle(mainEl, {
      store,
      refreshHeader: renderHeader,
      remount: renderBattleScreen,
      editPlan: () => setView('PL'),
      ...(hooks.ghost ? { ghost: hooks.ghost } : {}),
    });
  }

  function renderCharacterScreen(): void {
    renderHeader();
    renderCharacter(mainEl, { store, rerender: renderCharacterScreen });
  }

  /**
   * Repaint the league in place after a 🔵 spend: the purse in the header and
   * the cards below both change, and re-rendering the whole shell would throw
   * the reader back to the top of a long screen.
   */
  function renderLeagueScreen(): void {
    if (store.getState().ui.view !== 'LG') return;
    renderHeader();
    renderLeague(mainEl, { store, rerender: renderLeagueScreen, ...(hooks.league ? { cloud: hooks.league } : {}) });
  }

  /**
   * Repaint the 🍽️ screen in place after logging or deleting a meal: the
   * totals in the header and the cards below both change, and re-rendering the
   * whole shell would reset the scroll and the half-typed form state.
   */
  /** The 🍽️ screen's cloud ports — each present only when main.ts wired it. */
  function nutritionPorts(): { ai?: NutritionAiPort; push?: PushPort } {
    const nu = hooks.nutrition;
    if (!nu) return {};
    return { ai: nu.ai, ...(nu.push ? { push: nu.push } : {}) };
  }

  function renderNutritionScreen(): void {
    if (store.getState().ui.view !== 'NT') return;
    renderHeader();
    renderNutrition(mainEl, { store, rerender: renderNutritionScreen, ...nutritionPorts() });
  }

  /** Repaint the ⚖️ screen in place after a weigh-in — header line included. */
  function renderWeightScreen(): void {
    if (store.getState().ui.view !== 'WT') return;
    renderHeader();
    renderWeight(mainEl, { store, rerender: renderWeightScreen });
  }

  /** The 📸 screen's bytes: what main.ts supplied, or memory (bare tests). */
  const photoDeps: Pick<PhotosDeps, 'blobs' | 'prepare' | 'camera'> = hooks.photos ?? { blobs: new MemoryBlobStore() };

  /** Repaint the 📸 screen in place after a photo lands or goes — header included. */
  function renderPhotosScreen(): void {
    if (store.getState().ui.view !== 'PH') return;
    renderHeader();
    renderPhotos(mainEl, { store, rerender: renderPhotosScreen, ...photoDeps });
  }

  /** Re-render the editor in place (draft edits must not reset the scroll). */
  function renderPlanScreen(): void {
    if (store.getState().ui.view !== 'PL') return;
    renderHeader();
    renderPlanEditor(mainEl, { store, rerender: renderPlanScreen, close: () => setView(returnView) });
  }

  /* ------------------------------------------------- the questionnaire */

  /** The questionnaire's own root: first in <body>, shown instead of the app. */
  function onboardingRoot(): HTMLElement {
    let root = document.getElementById('onb');
    if (!root) {
      root = document.createElement('div');
      root.id = 'onb';
      root.className = 'onb';
      document.body.insertBefore(root, document.body.firstChild);
    }
    return root;
  }

  function hideOnboarding(): void {
    document.getElementById('onb')?.remove();
    if (document.body.classList.contains('onb-open')) document.body.classList.remove('onb-open');
  }

  /** Re-open the questionnaire prefilled, from the 👤 card on הגדרות. */
  function openProfileEdit(): void {
    openOnboarding(store, 'edit');
    render();
  }

  function onboardingDone(outcome: OnboardingOutcome): void {
    closeOnboarding();
    if (outcome.kind === 'cancelled') {
      render();
      return;
    }
    if (outcome.kind === 'finished' && outcome.mode === 'edit') {
      setView('ST');
      toast(tr(OB).toast.saved);
      return;
    }
    // A new user lands in the training hub: on the chosen plan's workout, or
    // in front of the plan picker when they chose (or skipped to) none.
    setView(defaultTabView(store.getState().plan));
    if (outcome.kind === 'finished') toast(tr(OB).toast.welcome(outcome.name));
  }

  /**
   * The questionnaire, INSTEAD of the app: the nav, header and screen are
   * emptied (nothing of the app runs underneath) and `body.onb-open` hides
   * their chrome, the footer and the rest timer.
   */
  function renderOnboardingScreen(): void {
    exitCharacterPreview();
    tabsEl.innerHTML = '';
    headerEl.innerHTML = '';
    mainEl.innerHTML = '';
    document.body.classList.add('onb-open');
    renderOnboarding(onboardingRoot(), { store, rerender: render, done: onboardingDone });
    hooks.onRender?.();
  }

  function render(): void {
    applyPrefs(store);
    // Battles run ONLY while the קרב tab is on screen — every render tears the
    // previous loop down before the new screen is mounted.
    stopBattle();
    // A fresh install is greeted by the questionnaire — only when main.ts asked
    // for it, and never anybody with history (`needsOnboarding`).
    if (hooks.onboarding === true && !isOnboardingOpen() && needsOnboarding(store.getState(), store.getEvents())) {
      openOnboarding(store, 'onboard');
    }
    if (isOnboardingOpen()) {
      renderOnboardingScreen();
      return;
    }
    hideOnboarding();
    // Canonicalise BEFORE painting anything: the stored view can point at a day
    // the plan no longer has (a preset picked in the editor, a cloud pull that
    // deleted a day on another device, a plan saved over a store that booted on
    // a different weekday's default). `setView` already resolves that case for
    // taps; the boot/plain-render path must do the same or those users land on
    // an empty workout screen.
    {
      const stored = store.getState().ui.view;
      const resolved = resolveView(stored);
      if (resolved !== stored) {
        store.update((draft) => {
          draft.ui.view = resolved;
        });
      }
    }
    renderTabs();
    renderHeader();
    const view = store.getState().ui.view;
    // A try-on of a locked character (ui/character.ts) is a look at the דמות
    // screen, nothing more: leaving the screen ends it, so no other screen —
    // the arena above all — can ever draw a character the player does not own.
    if (view !== 'CH') exitCharacterPreview();
    if (view === 'ST') {
      renderSettings(mainEl, {
        store,
        rerender: render,
        editPlan: () => setView('PL'),
        ...hooks.settings,
        profile: { open: openProfileEdit, offer: hooks.onboarding === true },
        choosePlan: () => setHub('TR'),
      });
    } else if (view === 'H') {
      renderHistory(mainEl, { store });
    } else if (view === 'SS') {
      renderStats(mainEl, { store });
    } else if (view === 'NT') {
      renderNutrition(mainEl, { store, rerender: renderNutritionScreen, ...nutritionPorts() });
    } else if (view === 'WT') {
      renderWeight(mainEl, { store, rerender: renderWeightScreen });
    } else if (view === 'PH') {
      renderPhotos(mainEl, { store, rerender: renderPhotosScreen, ...photoDeps });
    } else if (view === 'LG') {
      renderLeague(mainEl, { store, rerender: renderLeagueScreen, ...(hooks.league ? { cloud: hooks.league } : {}) });
    } else if (view === 'PL') {
      renderPlanEditor(mainEl, { store, rerender: renderPlanScreen, close: () => setView(returnView) });
    } else if (view === 'CH') {
      // A shop purchase re-renders the דמות screen in place (header + main, no
      // scroll reset) so the character, the stat grid and the purse update
      // without throwing the player back to the top of the page.
      renderCharacter(mainEl, { store, rerender: renderCharacterScreen });
    } else if (view === 'BT') {
      renderBattle(mainEl, {
        store,
        refreshHeader: renderHeader,
        remount: renderBattleScreen,
        editPlan: () => setView('PL'),
        ...(hooks.ghost ? { ghost: hooks.ghost } : {}),
      });
    } else if (needsPlanChoice(store.getState())) {
      // No plan yet: the training hub IS the plan picker.
      renderPlanChoice(mainEl, {
        store,
        started: () => setView(defaultTabView(store.getState().plan)),
        build: () => setView('PL'),
      });
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

  // An invitation link opened while the app is already open in this tab.
  window.addEventListener('hashchange', () => {
    if (document.getElementById('main') !== mainEl) return; // a shell that was replaced
    if (!captureRivalInvite(store, window)) return;
    rememberInner('LG');
    render();
  });

  return { render };
}
