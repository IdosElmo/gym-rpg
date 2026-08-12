/**
 * core/dev.ts — the DEV GRANTS, as events.
 *
 * PURE like every other module in `core/`: no DOM, no storage, no `Date.now()`
 * and no `uuid()` (the caller passes the id in, which is also what lets a test
 * pin an exact event). It decides WHAT a dev grant is; `dev/actions.ts` decides
 * when one happens and `core/game.ts` writes it.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP
 * ------------------------------------
 * A dev grant is a REAL event through the NORMAL pipeline — appended to the
 * append-only log, folded by the same reducer, merged by the same union, synced
 * to the same devices. Nothing here writes state, nothing here is a special case
 * inside the game, and there is no "dev mode" flag that changes how the app
 * behaves. Which means every invariant the app rests on keeps holding for free:
 * live state === replay, merges converge, duplicates pay once.
 *
 * What makes them dev grants is one field, `dev: true`, which buys three things:
 *   * the feed marks them 🛠, so a boosted character is never a mystery;
 *   * the published ghost carries a 🛠 flag while any of them is in force, so an
 *     opponent knows what they are fighting;
 *   * they can be taken back in one event (`dev_purge`) — see `liveEvents`.
 *
 * IDEMPOTENCY. A dev grant has no natural slot (no date+exercise+set, no wave,
 * no purchase), so every one of them carries its own `dev|<uuid>` key and the
 * reducer folds it through a ledger: `energyGranted` for energy (that guard
 * already existed), `devKeys` for XP and coins. Two devices merging their logs
 * therefore pay each grant exactly once, in either order.
 *
 * NOT TRAINING. Dev XP never adds a workout day (see `applyGameEvent`), so the
 * streak keeps meaning "I turned up" — the one number a dev panel must not be
 * able to fake.
 */

import { BODY_PARTS, type BodyPart, type DayKey } from '../data/program.ts';
import { BALANCE } from './balance.ts';
import {
  buildWorkoutCompletionGrant,
  levelForXp,
  levelUpEvents,
  round2,
  xpForLevel,
  type PendingEvent,
} from './xp.ts';
import type { DevResetScope, GameState } from '../storage/DataStore.ts';

/** The default sizes of the panel's buttons — one place, like `BALANCE`. */
export const DEV_GRANTS = {
  energy: 100,
  coins: 500,
  xp: 250,
  levels: 1,
} as const;

/** The idempotency key of one dev grant. The `dev|` prefix is its namespace. */
export function devKey(id: string): string {
  return `dev|${id}`;
}

/** Everything a dev grant needs from the outside world, and nothing more. */
export interface DevGrantArgs {
  /** ISO date to stamp on the event (the feed groups by it). */
  date: string;
  /** Timestamp of the first emitted event (siblings get +1ms each). */
  ts: number;
  /** A unique id — `uuid()` in the app, a fixed string in a test. */
  id: string;
}

/** `+n ⚡`, through the ordinary energy event with a dev key. */
export function buildDevEnergy(amount: number, a: DevGrantArgs): PendingEvent[] {
  const n = round2(Math.max(0, amount));
  if (n <= 0) return [];
  return [
    {
      type: 'energy_gained',
      payload: { date: a.date, amount: n, source: 'dev', retro: false, dev: true, key: devKey(a.id) },
      ts: a.ts,
    },
  ];
}

/** `+n 🪙`, through the one event that pays coins without claiming a fight. */
export function buildDevCoins(amount: number, a: DevGrantArgs): PendingEvent[] {
  const n = round2(Math.max(0, amount));
  if (n <= 0) return [];
  return [
    {
      type: 'coins_granted',
      payload: { date: a.date, amount: n, source: 'dev', dev: true, key: devKey(a.id) },
      ts: a.ts,
    },
  ];
}

/**
 * XP straight into one or more body parts, plus the `level_up` markers it
 * earns — the same two-event shape a real set produces, so the feed, the level
 * curve and the character screen need to know nothing about dev mode.
 */
export function buildDevXp(
  game: GameState,
  parts: Partial<Record<BodyPart, number>>,
  a: DevGrantArgs,
): PendingEvent[] {
  const clean: Partial<Record<BodyPart, number>> = {};
  let total = 0;
  for (const part of BODY_PARTS) {
    const amount = round2(Math.max(0, parts[part] ?? 0));
    if (amount <= 0) continue;
    clean[part] = amount;
    total = round2(total + amount);
  }
  if (total <= 0) return [];

  return [
    {
      type: 'xp_gained',
      payload: {
        date: a.date,
        source: 'dev',
        parts: clean,
        total,
        retro: false,
        dev: true,
        key: devKey(a.id),
      },
      ts: a.ts,
    },
    ...levelUpEvents(game.parts, clean, { date: a.date, retro: false, ts: a.ts + 1, dev: true }),
  ];
}

/** `+n XP` into ONE part — the panel's small part picker. */
export function buildDevPartXp(
  game: GameState,
  part: BodyPart,
  amount: number,
  a: DevGrantArgs,
): PendingEvent[] {
  return buildDevXp(game, { [part]: amount }, a);
}

/**
 * `+n levels` on EVERY body part.
 *
 * Expressed as XP, never as a level: levels are DERIVED from XP everywhere in
 * this app, and an event that set a level directly would be the one fact the
 * replay could not re-derive. So each part is given exactly the XP that takes it
 * to `level + n` (capped by `BALANCE.xp.maxLevel`), and the curve does the rest.
 */
export function buildDevLevels(game: GameState, levels: number, a: DevGrantArgs): PendingEvent[] {
  const steps = Math.max(1, Math.floor(levels));
  const parts: Partial<Record<BodyPart, number>> = {};
  for (const part of BODY_PARTS) {
    const xp = game.parts[part].xp;
    const need = xpToReach(xp, Math.min(BALANCE.xp.maxLevel, levelForXp(xp) + steps));
    if (need > 0) parts[part] = need;
  }
  return buildDevXp(game, parts, a);
}

/**
 * The XP that takes a pool from where it is to exactly `target`.
 *
 * It walks the ladder the SAME way `levelForXp` walks it — subtracting one
 * `xpForLevel` at a time — rather than using the closed-form `totalXpToReach`,
 * because the two disagree in the last bits of a float: the closed form can land
 * a hundredth of a point below the sum the level check actually performs, and
 * "+1 level" that leaves you one XP short of the level is a bug you only notice
 * on the character screen. The final `+ 0.01` is the same defence made explicit,
 * since the amount is rounded to two decimals before it goes into the event.
 */
function xpToReach(currentXp: number, target: number): number {
  let remaining = Math.max(0, currentXp);
  let level = 1;
  while (level < target) {
    const step = xpForLevel(level);
    if (remaining < step) break;
    remaining -= step;
    level += 1;
  }
  if (level >= target) return 0;
  let need = -remaining;
  for (let l = level; l < target; l += 1) need += xpForLevel(l);
  return need > 0 ? round2(need) + 0.01 : 0;
}

/**
 * The workout-completion bonus for a date, marked as a dev grant.
 *
 * It deliberately REUSES `buildWorkoutCompletionGrant` — same XP, same energy,
 * same `bonus|<date>` key, same "once per date" guard — and only stamps
 * `dev: true` on the payloads. So it is the real bonus (a second press, or the
 * same date arriving from another device, pays nothing) with an honest label,
 * and the returned `[]` means "today's bonus was already granted".
 */
export function buildDevComplete(game: GameState, day: DayKey, a: DevGrantArgs): PendingEvent[] {
  return buildWorkoutCompletionGrant(game, { date: a.date, day, retro: false, ts: a.ts }).map((e) => ({
    ...e,
    payload: { ...e.payload, dev: true },
  }));
}

/** The cycle a reset of `scope` on `date` would open (1 for the first one). */
export function devResetCycle(game: GameState, scope: DevResetScope, date: string): number {
  return (game.devCycles[`${scope}|${date}`] ?? 0) + 1;
}

/**
 * Re-open today's daily challenge (or today's duels) for one more attempt.
 *
 * The event names the CYCLE it opens, which is what makes two devices that both
 * pressed the button converge on one extra attempt rather than two — see
 * `DevResetPayload` and the reducer.
 */
export function buildDevReset(game: GameState, scope: DevResetScope, a: DevGrantArgs): PendingEvent[] {
  return [
    {
      type: 'dev_reset',
      payload: { date: a.date, scope, cycle: devResetCycle(game, scope, a.date), dev: true, key: devKey(a.id) },
      ts: a.ts,
    },
  ];
}

/**
 * TAKE BACK every dev grant made so far — the feature's undo.
 *
 * It carries nothing but a date because it undoes by OMISSION: `liveEvents`
 * drops every dev grant that sorts before it, so the fold produces exactly the
 * state a log without them would have. Always emitted (even with nothing to
 * undo), because pressing it must leave a mark in the feed saying so.
 */
export function buildDevPurge(a: DevGrantArgs): PendingEvent[] {
  return [{ type: 'dev_purge', payload: { date: a.date, dev: true, key: devKey(a.id) }, ts: a.ts }];
}
