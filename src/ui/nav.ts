/**
 * ui/nav.ts — the two-level navigation model.
 *
 * The app used to have ONE flat bar: every workout day of the week plus דמות,
 * קרב and היסטוריה, which a four-day A/B split pushed to seven tabs and a
 * sideways scroll. Seven equal-looking things in one row is not a navigation
 * bar, it is a list — nothing tells you that "רביעי" and "היסטוריה" are
 * different KINDS of destination.
 *
 * So navigation has two levels. The first is the BOTTOM BAR — five fixed hubs,
 * an icon and a word each, where the thumb already is (the "Pulse" redesign):
 *
 *   אימון      — the training hub: one inner tab per scheduled workout
 *                occurrence (`scheduleTabs`), plus the plan editor (`PL`),
 *                which is reached from the header's edit button rather than
 *                from a tab of its own.
 *   תזונה      — the meal tracker (`NT`), alone. Logging a meal is a daily act
 *                like training, so it is a hub of its own.
 *   הרפתקה     — the game: קרב (`BT`), דמות (`CH`) and ליגה (`LG` — the
 *                monthly leaderboard fought with weekly 🔵).
 *   התקדמות    — everything that READS what the training added up to:
 *                היסטוריה (`H`), סטטיסטיקות (`SS`), משקל (`WT`) and תמונות
 *                (`PH`). Reading screens, not settings and not meals — which is
 *                why they left the settings and nutrition hubs.
 *   פרופיל     — הגדרות (`ST`): language and look, the profile, the account,
 *                the plan card and the data actions.
 *
 * The second level is the hub's own sub-views, a compact pill row under the
 * header — shown only when the hub HAS more than one view.
 *
 * THE STORE DID NOT CHANGE. There is no `hub` in `UiState`: the hub is DERIVED
 * from `ui.view` by `hubOf`, which is a total function over every view id the
 * app has ever persisted. That is what keeps this a UI reorganisation rather
 * than a data migration — an install left on `'H'`, on `'A'`, on `'d_alef@3'`
 * or on `'CH'` opens on exactly the screen it named, inside the hub that screen
 * now lives in.
 */

import type { ViewKey } from '../storage/DataStore.ts';
import type { IconName } from './icons.ts';

/** The five fixed hubs of the bottom bar. */
export type HubId = 'TR' | 'NU' | 'GM' | 'PR' | 'SE';

export interface Hub {
  readonly id: HubId;
  /** The bar's stroke icon (ui/icons.ts). */
  readonly icon: IconName;
  /** Hebrew caption of the main tab. */
  readonly title: string;
  /** Screen-reader description of the inner row this hub owns. */
  readonly innerLabel: string;
}

/** In reading order: אימון is the inline START (the right edge in Hebrew). */
export const HUBS: readonly Hub[] = [
  { id: 'TR', icon: 'dumbbell', title: 'אימון', innerLabel: 'ימי האימון' },
  { id: 'NU', icon: 'food', title: 'תזונה', innerLabel: 'מעקב תזונה' },
  { id: 'GM', icon: 'shield', title: 'הרפתקה', innerLabel: 'מסכי המשחק' },
  { id: 'PR', icon: 'chart', title: 'התקדמות', innerLabel: 'מסכי ההתקדמות' },
  { id: 'SE', icon: 'user', title: 'פרופיל', innerLabel: 'פרופיל והגדרות' },
] as const;

/** True for a string that names one of the five hubs. */
export function isHubId(v: unknown): v is HubId {
  return v === 'TR' || v === 'NU' || v === 'GM' || v === 'PR' || v === 'SE';
}

/** ONE inner tab: a view the user can reach by tapping inside a hub. */
export interface InnerTab {
  readonly viewId: string;
  /** Big line. */
  readonly title: string;
  /** Small line, or `''` when the tab is a single word. */
  readonly subtitle: string;
}

/**
 * The game hub's inner row — the arena first, since that is what it is for,
 * then the character it is fought with, then הליגה: קרב and דמות are things you
 * DO, and the league is what the doing adds up to over a month.
 */
export const GAME_TABS: readonly InnerTab[] = [
  { viewId: 'BT', title: 'קרב', subtitle: '' },
  { viewId: 'CH', title: 'דמות', subtitle: '' },
  { viewId: 'LG', title: 'ליגה', subtitle: '' },
] as const;

/**
 * The progress hub's inner row: the RECORD first (history — "what did I do on
 * the 4th"), then what it adds up to (stats), then the body's own two
 * measures — the number on the scale and what the mirror says.
 */
export const PROGRESS_TABS: readonly InnerTab[] = [
  { viewId: 'H', title: 'היסטוריה', subtitle: '' },
  { viewId: 'SS', title: 'סטטיסטיקות', subtitle: '' },
  { viewId: 'WT', title: 'משקל', subtitle: '' },
  { viewId: 'PH', title: 'תמונות', subtitle: '' },
] as const;

/**
 * The nutrition hub: the meals, alone. Day navigation (אתמול/מחר) lives INSIDE
 * the meal screen, because "which day am I looking at" is reading state, not
 * navigation between kinds of destination. One view = no inner row.
 */
export const NUTRITION_TABS: readonly InnerTab[] = [{ viewId: 'NT', title: 'תזונה', subtitle: '' }] as const;

/** The profile hub: the settings screen, alone (one view = no inner row). */
export const SETTINGS_TABS: readonly InnerTab[] = [{ viewId: 'ST', title: 'הגדרות', subtitle: '' }] as const;

/**
 * The hub a view belongs to. TOTAL: anything that is not one of the reserved
 * non-training screens is a workout day, and workout days are the training
 * hub — which is also the right answer for a day key this build has never seen
 * (one minted by a plan on another device).
 */
export function hubOf(view: string): HubId {
  if (view === 'BT' || view === 'CH' || view === 'LG') return 'GM';
  if (view === 'NT') return 'NU';
  if (view === 'H' || view === 'SS' || view === 'WT' || view === 'PH') return 'PR';
  if (view === 'ST') return 'SE';
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
  NU: 'NT',
  GM: 'BT',
  PR: 'H',
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
