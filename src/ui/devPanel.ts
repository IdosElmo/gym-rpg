/**
 * ui/devPanel.ts — the 🛠 מצב מפתח card at the bottom of ⚙️ הגדרות.
 *
 * IT ONLY EXISTS FOR THE OWNER. `renderSettings` renders it only when
 * `SettingsDeps.dev` is present, and `main.ts` only builds that once
 * `devGateOpen` has said yes (see `dev/gate.ts`). Signed out, another account or
 * the `file://` bundle: the card is not in the DOM at all — the same "absent,
 * not disabled" rule the account card and the duel card follow.
 *
 * It is a thin skin over `dev/actions.ts`: every button calls exactly the method
 * `window.gymDev` exposes, so the two surfaces can never drift apart. What this
 * file owns is layout and one confirm dialog (the copy is in
 * `i18n/messages/dev.ts`).
 *
 * WHY IT SITS UNDER THE DATA CARD. Everything above it on this screen is
 * something anybody may press; this is the one thing that is not. Putting it
 * last, after the destructive 🗑 מחיקה, keeps the screen's shape unchanged for
 * every other account — nothing moves, something is simply added.
 */

import { DEV_GRANTS } from '../core/dev.ts';
import { BODY_PART_HE, BODY_PARTS, type BodyPart } from '../data/program.ts';
import type { DevApi } from '../dev/actions.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { tr } from '../i18n/locale.ts';
import { bodyPartName } from '../i18n/content.ts';
import { dev as M } from '../i18n/messages/dev.ts';

export const DEV_PANEL_ID = 'devPanel';

/**
 * What the card needs: the actions, and nothing else.
 *
 * There is deliberately no `rerender` here — the API's own `onChange` is THE
 * repaint, so a grant looks the same whether it came from this card or from the
 * console. Two repaint paths would be two chances to forget one.
 */
export interface DevPanelDeps {
  api: DevApi;
}

/**
 * The confirm before a purge. It says what goes (the grants) AND what stays
 * (everything real), because the second half is the part people are afraid of.
 */
export const DEV_PURGE_CONFIRM = M.he.purgeConfirm;

/** A body part's name in the reader's language; an unknown key passes through. */
function partName(p: string): string {
  return Object.prototype.hasOwnProperty.call(BODY_PART_HE, p) ? bodyPartName(p as BodyPart) : p;
}

/** The card's markup. Pure string, like every other card renderer here. */
export function devPanelCard(): string {
  const m = tr(M);
  const options = BODY_PARTS.map((p) => `<option value="${esc(p)}">${esc(partName(p))}</option>`).join('');

  return `
  <section class="game-card dev-card" id="${DEV_PANEL_ID}">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub}</span></h3>
    <p class="gc-note">${m.note}</p>
    <div class="dev-actions">
      <button class="action-btn" id="devEnergy" type="button">${m.energy(DEV_GRANTS.energy)}</button>
      <button class="action-btn" id="devCoins" type="button">${m.coins(DEV_GRANTS.coins)}</button>
      <button class="action-btn" id="devLevels" type="button">${m.levels(DEV_GRANTS.levels)}</button>
      <button class="action-btn" id="devComplete" type="button">${m.complete}</button>
      <button class="action-btn" id="devResetDaily" type="button">${m.resetDaily}</button>
      <button class="action-btn" id="devResetDuels" type="button">${m.resetDuels}</button>
      <button class="action-btn" id="devCooldowns" type="button">${m.cooldowns}</button>
    </div>
    <div class="dev-xp">
      <label class="gc-note" for="devPart">${m.xpLabel(DEV_GRANTS.xp)}</label>
      <div class="dev-xp-row">
        <select class="dev-select" id="devPart" aria-label="${esc(m.part)}">${options}</select>
        <button class="action-btn" id="devXp" type="button">${m.grant}</button>
      </div>
    </div>
    <button class="action-btn danger" id="devPurge" type="button">${m.purge}</button>
    <p class="gc-note dim">${m.console}</p>
  </section>`;
}

/** Wire the card. Call after every render of it. */
export function bindDevPanel(root: ParentNode, deps: DevPanelDeps): void {
  const { api } = deps;

  const act = (id: string, run: () => string | null): void => {
    root.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', () => {
      const message = run();
      if (message) toast(message);
    });
  };

  // Read the catalog at CLICK time: the language may have changed since bind.
  const t = (): (typeof M.he)['toast'] => tr(M).toast;
  act('devEnergy', () => t().energy(DEV_GRANTS.energy, api.addEnergy()));
  act('devCoins', () => t().coins(DEV_GRANTS.coins, api.addCoins()));
  act('devLevels', () => t().levels(DEV_GRANTS.levels, api.levelAllParts()));
  act('devComplete', () => (api.completeToday() ? t().completed : t().alreadyCompleted));
  act('devResetDaily', () => (api.resetDaily() ? t().dailyReset : null));
  act('devResetDuels', () => (api.resetDuels() ? t().duelsReset : null));
  act('devCooldowns', () => (api.resetCooldowns() ? t().cooldowns : t().noBattle));

  act('devXp', () => {
    const part = root.querySelector<HTMLSelectElement>('#devPart')?.value ?? '';
    if (!api.addXp(part)) return t().unknownPart;
    return t().xp(DEV_GRANTS.xp, partName(part));
  });

  // The one button that takes something AWAY gets a confirm, exactly like 🗑.
  act('devPurge', () => {
    if (!confirm(tr(M).purgeConfirm)) return null;
    api.purge();
    return t().purged;
  });
}
