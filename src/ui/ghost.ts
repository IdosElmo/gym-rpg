/**
 * ui/ghost.ts — the "⚔️ דו-קרב רפאים" card on the קרב screen.
 *
 * A PURE string builder, like the rest of the card renderers: it is handed a
 * game state and one small view object and returns markup. It owns no state, no
 * network and no rules — `core/ghost.ts` decides what a ghost is worth,
 * `core/xp.ts` decides whether a duel may start, and `ui/battle.ts` drives it.
 *
 * IT DOES NOT EXIST WHEN SYNC DOES NOT. With no account behind the app (the
 * offline build, the `file://` bundle, or simply signed out) the card renders as
 * the empty string — not a disabled state, not an explanation, absent — exactly
 * like the account card it depends on. Someone using the offline app must never
 * be shown a cloud feature they cannot have.
 *
 * THE STATES, named in `data-state` so a test (and a stylesheet) can tell them
 * apart without reading Hebrew:
 *
 *   idle       nobody looked up yet — the handle field and the search button;
 *   searching  a lookup is in flight;
 *   missing    nobody answers to that handle (a Hebrew explanation, not an error
 *              code — the usual cause is a typo);
 *   ready      an opponent is on the card: their character, level and the
 *              lifetime record against them, plus the fee;
 *   locked     same, but the ⚡ is short — the button says what to do instead;
 *   done       today's duel with THIS opponent is already spent;
 *   live       the duel is on screen.
 */

import { BALANCE } from '../core/balance.ts';
import { ghostCharacterId, type GhostPayload } from '../core/ghost.ts';
import { duelCoins } from '../core/xp.ts';
import type { GameState, GhostDuelRecord, PartsProgress } from '../storage/DataStore.ts';
import { BODY_PARTS } from '../data/program.ts';
import { characterSvg } from './characterSvg.ts';
import { esc } from './dom.ts';
import { fmtXp } from './xpfx.ts';

export const GHOST_CARD_ID = 'btGhost';

/** One row of the ghosts table, as the screen needs it (structurally a `GhostRow`). */
export interface GhostLookupRow {
  handle: string;
  payload: Record<string, unknown>;
}

/**
 * Everything the arena needs from the cloud in order to run a duel — and no
 * more. `main.ts` implements it over the sync engine; the DOM tests implement it
 * over a `Map`. Absent (the offline build) means the card does not exist.
 */
export interface GhostDuelDeps {
  /**
   * Is there a live session? FALSE hides the card completely — a duel needs an
   * account on both sides, and offering one to somebody who cannot have it would
   * be a broken promise rather than a feature.
   */
  signedIn(): boolean;
  /** The name I publish under; `''` while it is not known yet. */
  myHandle(): string;
  /** Opponents fought recently, newest first. */
  recent(): readonly string[];
  /** Remember an opponent for next time. */
  remember(handle: string): void;
  /** Look somebody up by exact handle. Rejects only on a real failure. */
  fetch(handle: string): Promise<GhostLookupRow | null>;
}

/** The phases above, as data. */
export type GhostPhase = 'idle' | 'searching' | 'missing' | 'ready' | 'locked' | 'done' | 'live';

/** An opponent that was successfully looked up. */
export interface GhostOpponentView {
  /** The handle as typed (already canonical). */
  handle: string;
  ghost: GhostPayload;
}

export interface GhostCardView {
  /** My own published name — shown so it can be read out to the other player. */
  myHandle: string;
  /** What is currently in the input. */
  query: string;
  /** Opponents fought recently — a datalist, not a leaderboard. */
  recent: readonly string[];
  opponent: GhostOpponentView | null;
  /** In flight? */
  searching: boolean;
  /** A Hebrew problem to show (lookup failed, nobody there, …). */
  error: string;
  /** True while a duel is actually running in the arena. */
  live: boolean;
}

export function emptyGhostView(myHandle = '', recent: readonly string[] = []): GhostCardView {
  return { myHandle, query: '', recent, opponent: null, searching: false, error: '', live: false };
}

/** The six levels of a ghost, in the shape `characterSvg` draws from. */
function ghostParts(ghost: GhostPayload): PartsProgress {
  const out = {} as PartsProgress;
  for (const p of BODY_PARTS) out[p] = { xp: 0, level: ghost.parts[p] };
  return out;
}

/**
 * Draw somebody else's character.
 *
 * Their skin is drawn whether or not I own it — a ghost is a picture of THEM,
 * and ownership only ever governs what I may PLAY. The drawing is mirrored by
 * the stylesheet (`.gd-figure svg`), so the two fighters face each other.
 */
export function ghostFigure(ghost: GhostPayload): string {
  return characterSvg(ghostParts(ghost), {
    label: `הדמות של ${ghost.name}`,
    character: ghostCharacterId(ghost),
    equipment: { equipped: ghost.equipped, upgrades: ghost.upgrades },
  });
}

/** "3–1" — the lifetime record against one opponent. */
function tallyHe(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}

/** Which phase the card is in, given everything that can decide it. */
export function ghostPhase(game: GameState, view: GhostCardView, date: string): GhostPhase {
  if (view.live) return 'live';
  if (view.searching) return 'searching';
  if (!view.opponent) return view.error ? 'missing' : 'idle';
  if (game.duels.runs[`${date}|${view.opponent.handle}`]) return 'done';
  return game.energy < BALANCE.duel.entryEnergy ? 'locked' : 'ready';
}

/** The opponent's half of the card: who they are, and how it has gone so far. */
function preview(game: GameState, opponent: GhostOpponentView): string {
  const ghost = opponent.ghost;
  const tally = game.duels.byOpponent[opponent.handle] ?? { wins: 0, losses: 0, duels: 0 };
  const gear = Object.values(ghost.equipped).filter((id) => typeof id === 'string').length;
  return `
    <div class="gd-foe">
      <div class="gd-figure" aria-hidden="true">${ghostFigure(ghost)}</div>
      <div class="gd-meta">
        <b class="gd-name">${esc(ghost.name)}${
          // The 🛠 says this character was partly HANDED OUT, not trained (see
          // `GhostPayload.dev`). Small, next to the name, with the explanation
          // on the tooltip: enough to know what you are fighting, not a scarlet
          // letter.
          ghost.dev === true
            ? ` <span class="gd-dev" title="${esc(GHOST_DEV_HE)}" aria-label="${esc(GHOST_DEV_HE)}">🛠</span>`
            : ''
        }</b>
        <span class="gd-level">רמה ${ghost.characterLevel}${
          ghost.streakTier > 0 ? ` · 🔥 רצף ${ghost.streakTier}` : ''
        }${gear > 0 ? ` · ${gear} פריטי ציוד` : ''}</span>
        <span class="gd-record">${
          tally.duels > 0
            ? `מאזן מולו: <b>${tallyHe(tally.wins, tally.losses)}</b>`
            : 'עוד לא נפגשתם'
        }</span>
      </div>
    </div>`;
}

/**
 * The whole card, or `''` when there is no account behind it.
 *
 * `deps` being absent (the offline build) is handled by the caller — this
 * function is only ever asked for markup once a signed-in account exists.
 */
export function ghostCard(game: GameState, view: GhostCardView, date: string, run: { cleared: number } | null): string {
  const phase = ghostPhase(game, view, date);
  const fee = BALANCE.duel.entryEnergy;
  const totals = game.duels;
  const opponent = view.opponent;

  const head = `
    <div class="gd-head">
      <span class="gd-chip">⚔️ דו־קרב רפאים</span>
      ${
        totals.duels > 0
          ? `<span class="gd-stats">${esc(`מאזן כללי ${tallyHe(totals.wins, totals.losses)}`)}</span>`
          : ''
      }
      ${view.myHandle ? `<span class="gd-me">אתם: <b>${esc(view.myHandle)}</b></span>` : ''}
    </div>`;

  // The lookup row is on the card in every phase except the live fight: finding
  // the next opponent must never mean starting over.
  const list = view.recent.map((h) => `<option value="${esc(h)}"></option>`).join('');
  const search =
    phase === 'live'
      ? ''
      : `
    <div class="gd-search">
      <label class="gd-label" for="gdHandle">שם הלוחם של היריב</label>
      <div class="gd-row">
        <input class="gd-input" id="gdHandle" type="text" inputmode="text" autocomplete="off"
          list="gdRecent" maxlength="20" value="${esc(view.query)}" placeholder="לדוגמה: יוסי"
          aria-label="שם הלוחם של היריב">
        <button class="gd-find" id="gdFind" type="button" ${view.searching ? 'disabled' : ''}>
          ${view.searching ? '⏳ מחפש…' : '🔍 חיפוש'}
        </button>
      </div>
      <datalist id="gdRecent">${list}</datalist>
    </div>`;

  let body = '';
  if (phase === 'live' && opponent) {
    body = `
      <div class="gd-live">
        <b class="gd-count">⚔️ ${esc(opponent.ghost.name)}</b>
        <span>${run && run.cleared > 0 ? 'הרוח נפלה!' : 'הקרב בעיצומו'}</span>
      </div>
      <p class="gd-note">יציאה מהזירה עכשיו נחשבת הפסד — הדו־קרב של היום מול היריב הזה כבר נספר.</p>`;
  } else if (phase === 'missing') {
    body = `<p class="gd-note warn">${esc(view.error)}</p>`;
  } else if (opponent) {
    const record = game.duels.runs[`${date}|${opponent.handle}`] ?? null;
    body = preview(game, opponent) + resultLine(phase, record, fee, game.energy);
  } else {
    body = `<p class="gd-note">בקשו מהיריב את "שם הלוחם" שלו (מסך ההגדרות), הקלידו אותו כאן — ותילחמו בדמות האמיתית שלו: הרמות, הרצף והציוד שלו.</p>`;
  }

  return `
  <section class="gd" data-state="${phase}" aria-label="דו־קרב רפאים">
    ${head}
    ${search}
    ${body}
    ${
      phase === 'live'
        ? ''
        : `<p class="gd-foot">${fee} ⚡ לדו־קרב · ניצחון ${duelCoins(true)} 🪙, הפסד ${duelCoins(
            false,
          )} 🪙 · דו־קרב אחד ליום מול כל יריב.</p>`
    }
  </section>`;
}

/** The button (or the verdict) under a previewed opponent. */
function resultLine(phase: GhostPhase, record: GhostDuelRecord | null, fee: number, energy: number): string {
  if (phase === 'done' && record) {
    // The purse is quoted from the OUTCOME, not stored on the record: `won`
    // already says which of the two prices was paid, and this line only ever
    // describes TODAY's duel — so today's balance is the right one to read.
    return `
      <div class="gd-result ${record.won ? 'win' : 'loss'}">
        <b>${record.won ? '🏆 ניצחתם' : '💀 הפסדתם'}</b>
        <span>‏+${duelCoins(record.won)} 🪙 · הדו־קרב של היום מולו כבר נוצל — מחר אפשר שוב.</span>
      </div>`;
  }
  if (phase === 'locked') {
    return `
      <button class="gd-go locked" id="gdFight" type="button">🔒 חסרה אנרגיה · ${fee} ⚡</button>
      <p class="gd-note">יש לכם ${fmtXp(energy)} ⚡ מתוך ${fee}. לכו להתאמן — כל סט מסומן שווה ${BALANCE.energy.perSet} ⚡.</p>`;
  }
  // The prize is on the FOOT line (one place, every phase) — the button stays a
  // button.
  return `<button class="gd-go" id="gdFight" type="button">⚔️ צאו לדו־קרב · ${fee} ⚡</button>`;
}

/* ------------------------------------------------------------------ copy */

/** Hebrew for the 🛠 next to a dev-flagged opponent's name. */
export const GHOST_DEV_HE = 'הדמות הזו קיבלה הענקות במצב מפתח (לא רק אימונים אמיתיים)';

/** Hebrew for "nobody answers to that name". */
export function ghostMissingHe(handle: string): string {
  return `לא נמצא לוחם בשם "${handle}". בדקו את האיות — היריב רואה את השם שלו במסך ההגדרות.`;
}

/** Hebrew for "the lookup itself failed" (offline, server down). */
export const GHOST_LOOKUP_FAILED_HE = 'החיפוש נכשל — בדקו את החיבור לאינטרנט ונסו שוב.';

/** Hebrew for a payload we refused to read (wrong version, or nonsense). */
export const GHOST_BAD_PAYLOAD_HE = 'הנתונים של היריב לא נקראים — אולי הוא משתמש בגרסה אחרת של האפליקציה.';

/** Hebrew for "you have no name yet, so there is nothing to fight with". */
export const GHOST_NO_HANDLE_HE = 'עדיין אין לכם שם לוחם — קבעו אחד במסך ההגדרות כדי להילחם.';
