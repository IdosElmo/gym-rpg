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
 * file owns is Hebrew, layout and one confirm dialog.
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
export const DEV_PURGE_CONFIRM =
  'לנקות את כל שיפורי המפתח? האנרגיה, המטבעות, ה־XP והאיפוסים שניתנו במצב מפתח יבוטלו, ' +
  'והדמות תחזור למצב שנובע מהאימונים האמיתיים בלבד. אימונים, קרבות ורכישות אמיתיים נשארים.';

/** The card's markup. Pure string, like every other card renderer here. */
export function devPanelCard(): string {
  const options = BODY_PARTS.map(
    (p) => `<option value="${esc(p)}">${esc(BODY_PART_HE[p as BodyPart] ?? p)}</option>`,
  ).join('');

  return `
  <section class="game-card dev-card" id="${DEV_PANEL_ID}">
    <h3 class="gc-title">🛠 מצב מפתח <span class="gc-sub">חשבון הבעלים בלבד</span></h3>
    <p class="gc-note">בדיקת יכולות בלי להתאמן. כל הענקה נרשמת ביומן כאירוע אמיתי מסומן 🛠,
      מסתנכרנת לכל המכשירים, ומופיעה גם ליריבים בדו־קרב.</p>
    <div class="dev-actions">
      <button class="action-btn" id="devEnergy" type="button">⚡ +${DEV_GRANTS.energy} אנרגיה</button>
      <button class="action-btn" id="devCoins" type="button">🪙 +${DEV_GRANTS.coins} מטבעות</button>
      <button class="action-btn" id="devLevels" type="button">⬆ +${DEV_GRANTS.levels} רמה לכל חלקי הגוף</button>
      <button class="action-btn" id="devComplete" type="button">💪 השלמת אימון היום</button>
      <button class="action-btn" id="devResetDaily" type="button">🎲 איפוס אתגר יומי</button>
      <button class="action-btn" id="devResetDuels" type="button">⚔️ איפוס דו־קרבות היום</button>
      <button class="action-btn" id="devCooldowns" type="button">⏳ איפוס זמני קירור</button>
    </div>
    <div class="dev-xp">
      <label class="gc-note" for="devPart">+${DEV_GRANTS.xp} XP לחלק גוף</label>
      <div class="dev-xp-row">
        <select class="dev-select" id="devPart" aria-label="חלק גוף">${options}</select>
        <button class="action-btn" id="devXp" type="button">✨ הענקה</button>
      </div>
    </div>
    <button class="action-btn danger" id="devPurge" type="button">🧹 ניקוי שיפורי מפתח</button>
    <p class="gc-note dim">אותן פעולות זמינות בקונסולה דרך <b>gymDev</b> — הקלידו <b>gymDev.help()</b>.</p>
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

  act('devEnergy', () => `🛠 +${DEV_GRANTS.energy} ⚡ · סה״כ ${api.addEnergy()} ⚡`);
  act('devCoins', () => `🛠 +${DEV_GRANTS.coins} 🪙 · סה״כ ${api.addCoins()} 🪙`);
  act('devLevels', () => `🛠 +${DEV_GRANTS.levels} רמה לכל חלקי הגוף · רמה ${api.levelAllParts()}`);
  act('devComplete', () =>
    api.completeToday() ? '🛠 בונוס סיום האימון של היום ניתן' : '🛠 הבונוס של היום כבר ניתן',
  );
  act('devResetDaily', () => (api.resetDaily() ? '🛠 האתגר היומי נפתח מחדש' : null));
  act('devResetDuels', () => (api.resetDuels() ? '🛠 דו־קרבות היום נפתחו מחדש' : null));
  act('devCooldowns', () =>
    api.resetCooldowns()
      ? '🛠 זמני הקירור אופסו'
      : '🛠 אין קרב פעיל — הקירורים מתאפסים ממילא בכניסה לזירה',
  );

  act('devXp', () => {
    const part = root.querySelector<HTMLSelectElement>('#devPart')?.value ?? '';
    if (!api.addXp(part)) return '🛠 חלק גוף לא מוכר';
    return `🛠 +${DEV_GRANTS.xp} XP ל${BODY_PART_HE[part as BodyPart] ?? part}`;
  });

  // The one button that takes something AWAY gets a confirm, exactly like 🗑.
  act('devPurge', () => {
    if (!confirm(DEV_PURGE_CONFIRM)) return null;
    api.purge();
    return '🛠 שיפורי המפתח נוקו — הדמות חזרה לאימונים האמיתיים';
  });
}
