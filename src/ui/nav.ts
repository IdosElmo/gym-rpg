/**
 * ui/nav.ts — the two-level navigation model.
 *
 * The app used to have ONE flat bar: every workout day of the week plus דמות,
 * קרב and היסטוריה, which a four-day A/B split pushed to seven tabs and a
 * sideways scroll. Seven equal-looking things in one row is not a navigation
 * bar, it is a list — nothing tells you that "רביעי" and "היסטוריה" are
 * different KINDS of destination.
 *
 * So the bar became two levels:
 *
 *   🏋️ אימון   — the training hub: one inner tab per scheduled workout
 *                 occurrence (`scheduleTabs`), plus the plan editor (`PL`),
 *                 which is still reached from the ⚙️ header button rather than
 *                 from a tab of its own.
 *   🎮 קרב     — the game hub: קרב (`BT`) and דמות (`CH`).
 *   ⚙️ הגדרות  — the settings hub: הגדרות (`ST` — account, plan card, data
 *                 actions), היסטוריה (`H` — the workout log + the feed) and
 *                 📊 סטטיסטיקות (`SS` — what that log adds up to).
 *
 * THE STORE DID NOT CHANGE. There is no `hub` in `UiState`: the hub is DERIVED
 * from `ui.view` by `hubOf`, which is a total function over every view id the
 * app has ever persisted. That is what keeps this a UI reorganisation rather
 * than a data migration — an install left on `'H'`, on `'A'`, on `'d_alef@3'`
 * or on `'CH'` opens on exactly the screen it named, inside the hub that screen
 * now lives in.
 */

import type { ViewKey } from '../storage/DataStore.ts';

/** The three fixed hubs of the main bar. */
export type HubId = 'TR' | 'GM' | 'SE';

export interface Hub {
  readonly id: HubId;
  /** Big glyph of the main tab. */
  readonly icon: string;
  /** Hebrew caption of the main tab. */
  readonly title: string;
  /** Screen-reader description of the inner row this hub owns. */
  readonly innerLabel: string;
}

export const HUBS: readonly Hub[] = [
  { id: 'TR', icon: '🏋️', title: 'אימון', innerLabel: 'ימי האימון' },
  { id: 'GM', icon: '🎮', title: 'קרב', innerLabel: 'מסכי המשחק' },
  { id: 'SE', icon: '⚙️', title: 'הגדרות', innerLabel: 'הגדרות והיסטוריה' },
] as const;

/** ONE inner tab: a view the user can reach by tapping inside a hub. */
export interface InnerTab {
  readonly viewId: string;
  /** Big line. */
  readonly title: string;
  /** Small line, or `''` when the tab is a single word. */
  readonly subtitle: string;
}

/** The game hub's inner row — the arena first, since that is what it is for. */
export const GAME_TABS: readonly InnerTab[] = [
  { viewId: 'BT', title: '⚔️ קרב', subtitle: '' },
  { viewId: 'CH', title: '🦸 דמות', subtitle: '' },
] as const;

/**
 * The settings hub's inner row — settings FIRST, then the two READING screens.
 *
 * History is not a setting, but it is the other thing that lives outside a
 * workout and outside the game, and burying it in a fourth main tab would undo
 * the point of having exactly three. Settings leads because the hub's own name
 * promises it.
 *
 * 📊 סטטיסטיקות joins it for exactly the same reason, and sits AFTER history on
 * purpose: history is the record ("what did I do on the 4th"), statistics is
 * what that record adds up to. Reading the raw thing before its summary is the
 * order the two screens were built in and the order they make sense in.
 */
export const SETTINGS_TABS: readonly InnerTab[] = [
  { viewId: 'ST', title: 'הגדרות', subtitle: '' },
  { viewId: 'H', title: 'היסטוריה', subtitle: '' },
  { viewId: 'SS', title: '📊 סטטיסטיקות', subtitle: '' },
] as const;

/**
 * The hub a view belongs to. TOTAL: anything that is not one of the four
 * reserved non-training screens is a workout day, and workout days are the
 * training hub — which is also the right answer for a day key this build has
 * never seen (one minted by a plan on another device).
 */
export function hubOf(view: string): HubId {
  if (view === 'BT' || view === 'CH') return 'GM';
  if (view === 'ST' || view === 'H' || view === 'SS') return 'SE';
  return 'TR'; // every day view, and the plan editor
}

/**
 * The view a hub opens on when nothing better is remembered.
 *
 * `null` for the training hub: its home is the plan's default tab, which only
 * the plan can answer (see `defaultTabView`).
 */
export const HUB_HOME: Readonly<Record<HubId, ViewKey | null>> = {
  TR: null,
  GM: 'BT',
  SE: 'ST',
};

/**
 * True for a view worth REMEMBERING as a hub's last inner tab.
 *
 * The plan editor is excluded on purpose: it is a modal-ish screen you enter
 * from a button and leave with ←, so coming back to the אימון hub from קרב
 * should land on the workout you were doing, not back inside the editor.
 */
export function isRememberableInner(view: string): boolean {
  return view !== 'PL';
}
