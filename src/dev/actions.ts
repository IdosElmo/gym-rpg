/**
 * dev/actions.ts — WHAT the dev panel does, as one small object.
 *
 * Both surfaces of the feature call exactly this: the card in ⚙️ הגדרות
 * (`ui/devPanel.ts`) and `window.gymDev` (`dev/window.ts`). There is no second
 * implementation of "give me 100 ⚡" behind the console — a button and a typed
 * command produce the same events, in the same order, through the same commit,
 * which is why the console API needs no tests of its own beyond "it is wired".
 *
 * Everything it writes goes through `core/game.ts`'s commit — the same one every
 * real grant uses — so a dev grant is an ordinary event in an ordinary log:
 * it replays, it merges, it syncs to the other device, and it can be taken back
 * (`purge`). See `core/dev.ts` for what each grant IS.
 *
 * Every dependency that is not the store is injectable, because every one of
 * them is a thing a test has to pin: the clock, the uuid, today's plan day, the
 * live battle (for the cooldowns) and the repaint.
 */

import { commit, commitRebuild, gameOf } from '../core/game.ts';
import {
  DEV_GRANTS,
  buildDevCoins,
  buildDevComplete,
  buildDevEnergy,
  buildDevLevels,
  buildDevPartXp,
  buildDevPurge,
  buildDevReset,
} from '../core/dev.ts';
import { todayISO } from '../core/workout.ts';
import { BODY_PARTS, type BodyPart, type DayKey } from '../data/program.ts';
import type { DataStore, GameState } from '../storage/DataStore.ts';
import { uuid } from '../util/uuid.ts';

export interface DevDeps {
  store: DataStore;
  /** The clock. Injected so a test can pin the date every event is stamped with. */
  now?: () => Date;
  /** Unique id per grant — its idempotency key. */
  id?: () => string;
  /** Today's plan day, for the completion bonus. Defaults to the built-in 'A'. */
  day?: () => DayKey;
  /**
   * Zero the skill cooldowns of the battle that is on screen, if any. Returns
   * false when there is none — which is not a failure: leaving the arena already
   * resets them, so there would be nothing to do.
   */
  resetCooldowns?: () => boolean;
  /** Repaint after a grant (the panel passes the app's render). */
  onChange?: () => void;
}

/**
 * The dev API — the shape `window.gymDev` has, and the shape the panel drives.
 *
 * Every method returns something the caller can show: a number for a grant, a
 * boolean for "did it actually do anything".
 */
export interface DevApi {
  /** `+n ⚡`. Returns the energy after the grant. */
  addEnergy(amount?: number): number;
  /** `+n 🪙`. Returns the purse after the grant. */
  addCoins(amount?: number): number;
  /** `+n XP` into one body part. False when the part name is not one of the six. */
  addXp(part: string, amount?: number): boolean;
  /** `+n` levels on every body part. Returns the new headline character level. */
  levelAllParts(levels?: number): number;
  /** Today's workout-completion bonus. False when it was already granted. */
  completeToday(): boolean;
  /** Re-open today's daily challenge. */
  resetDaily(): boolean;
  /** Re-open today's duels. */
  resetDuels(): boolean;
  /** Zero the skill cooldowns of the battle on screen. False when none is running. */
  resetCooldowns(): boolean;
  /** Take back every dev grant — the character returns to its real training. */
  purge(): boolean;
  /** A frozen deep copy of the game state. */
  state(): GameState;
  /** Usage, in Hebrew and English. Also printed to the console. */
  help(): string;
}

function isBodyPart(v: string): v is BodyPart {
  return (BODY_PARTS as readonly string[]).includes(v);
}

/**
 * A snapshot nobody can accidentally mutate.
 *
 * `state()` exists to be READ from a console; handing out the live object would
 * make "let me peek at the state" a way to corrupt it in a way no replay could
 * explain. JSON round-trip + freeze: the state is plain data by construction
 * (that is what makes it replayable), so there is nothing else to preserve.
 */
function frozenSnapshot(game: GameState): GameState {
  const copy = JSON.parse(JSON.stringify(game)) as GameState;
  const freeze = (v: unknown): void => {
    if (typeof v !== 'object' || v === null || Object.isFrozen(v)) return;
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) freeze(child);
  };
  freeze(copy);
  return copy;
}

export const DEV_HELP_HE = [
  '🛠 מצב מפתח — window.gymDev',
  '',
  `gymDev.addEnergy(n = ${DEV_GRANTS.energy})    ⚡ הענקת אנרגיה  · grant battle energy`,
  `gymDev.addCoins(n = ${DEV_GRANTS.coins})     🪙 הענקת מטבעות  · grant coins`,
  `gymDev.addXp(part, n = ${DEV_GRANTS.xp})   ✨ XP לחלק גוף     · grant XP to one body part`,
  `     part: ${BODY_PARTS.join(' | ')}`,
  `gymDev.levelAllParts(n = ${DEV_GRANTS.levels})    ⬆ רמה לכל חלקי הגוף · +n levels everywhere`,
  'gymDev.completeToday()      💪 בונוס סיום אימון להיום · today\'s completion bonus',
  'gymDev.resetDaily()         🎲 פתיחת האתגר היומי מחדש · replay today\'s challenge',
  'gymDev.resetDuels()         ⚔️ פתיחת דו־קרבות היום מחדש · replay today\'s duels',
  'gymDev.resetCooldowns()     ⏳ איפוס זמני קירור (רק בקרב פעיל) · live battle only',
  'gymDev.purge()              🧹 ביטול כל הענקות המפתח · undo every dev grant',
  'gymDev.state()              📋 תצלום קפוא של מצב המשחק · frozen game state',
  '',
  'כל הענקה היא אירוע אמיתי ביומן, מסומן 🛠, ומסתנכרנת לכל המכשירים.',
  'Every grant is a real, 🛠-marked event in the log and syncs across devices.',
].join('\n');

/** Build the dev API over a store. Pure wiring — it holds no state of its own. */
export function createDevApi(deps: DevDeps): DevApi {
  const { store } = deps;
  const clock = (): Date => (deps.now ? deps.now() : new Date());
  const nextId = (): string => (deps.id ? deps.id() : uuid());
  const changed = <T>(value: T): T => {
    deps.onChange?.();
    return value;
  };
  /** The three things every grant needs: the date, the timestamp and the id. */
  const args = (now: Date): { date: string; ts: number; id: string } => ({
    date: todayISO(now),
    ts: now.getTime(),
    id: nextId(),
  });

  return {
    addEnergy(amount = DEV_GRANTS.energy): number {
      const now = clock();
      commit(store, buildDevEnergy(amount, args(now)), now);
      return changed(gameOf(store).energy);
    },

    addCoins(amount = DEV_GRANTS.coins): number {
      const now = clock();
      commit(store, buildDevCoins(amount, args(now)), now);
      return changed(gameOf(store).battle.coins);
    },

    addXp(part: string, amount = DEV_GRANTS.xp): boolean {
      if (!isBodyPart(part)) return false;
      const now = clock();
      const events = buildDevPartXp(gameOf(store), part, amount, args(now));
      if (events.length === 0) return false;
      commit(store, events, now);
      return changed(true);
    },

    levelAllParts(levels = DEV_GRANTS.levels): number {
      const now = clock();
      commit(store, buildDevLevels(gameOf(store), levels, args(now)), now);
      return changed(gameOf(store).level);
    },

    completeToday(): boolean {
      const now = clock();
      const day = deps.day ? deps.day() : ('A' as DayKey);
      const events = buildDevComplete(gameOf(store), day, args(now));
      if (events.length === 0) return false; // today's bonus was already granted
      commit(store, events, now);
      return changed(true);
    },

    resetDaily(): boolean {
      const now = clock();
      commit(store, buildDevReset(gameOf(store), 'daily', args(now)), now);
      return changed(true);
    },

    resetDuels(): boolean {
      const now = clock();
      commit(store, buildDevReset(gameOf(store), 'duels', args(now)), now);
      return changed(true);
    },

    /**
     * The ONE action that writes no event, because there is nothing to write:
     * cooldowns live in the battle's in-memory runtime and never survive leaving
     * the arena. An event for them would be a fact about a screen.
     */
    resetCooldowns(): boolean {
      const done = deps.resetCooldowns?.() ?? false;
      return done ? changed(true) : false;
    },

    purge(): boolean {
      const now = clock();
      // REBUILD, not fold: a purge un-does events that are already folded in.
      // See `commitRebuild` for why replaying is the sound implementation.
      commitRebuild(store, buildDevPurge(args(now)), now);
      return changed(true);
    },

    state(): GameState {
      return frozenSnapshot(gameOf(store));
    },

    help(): string {
      console.log(DEV_HELP_HE);
      return DEV_HELP_HE;
    },
  };
}
