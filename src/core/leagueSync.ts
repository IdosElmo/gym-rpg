/**
 * core/leagueSync.ts — הליגה over the wire: what one account publishes about a
 * closed week, and what the other account is allowed to believe about it.
 *
 * PURE, like every other module in `core/`: no DOM, no storage, no network and
 * no `Date.now()`. `sync/engine.ts` owns WHEN a row travels; this module owns
 * WHAT a row is, in both directions.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY A ROW AND NOT AN EVENT
 * ───────────────────────────────────────────────────────────────────────────
 * The same split the ghost duel draws, for the same reason. `events` is
 * append-only, private, and the single source of truth for an account's OWN
 * state. `league_weeks` is a SIDE CHANNEL: one row per (account, week),
 * overwritten in place, readable by the other player. Nothing fetched here ever
 * folds back into the log — the opponent's score is a number we DISPLAY, never
 * a fact we replay. Losing the whole table costs each player one re-publish.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS PUBLISHED, AND WHAT IS DELIBERATELY NOT
 * ───────────────────────────────────────────────────────────────────────────
 * A published row is one CLOSED week's grade: the score, its four components,
 * whether the week minted its 🔵, and the three numbers that explain it (volume,
 * days, PRs). That is the leaderboard, and it is all of it.
 *
 * NOT published: `redemptions`, `challenges`, `completions` — what somebody
 * bought with their coins, and which challenge they staked. Spending is private
 * between a person and their partner in the real world; the league needs to know
 * who trained better, not who cashed it in for what. It is also not needed: a
 * month's standing is a function of the weekly scores alone.
 *
 * Also not published: sessions, exercises, weights, dates of training, the plan,
 * XP, levels, gear, energy, email or the user id. A row is eleven numbers and a
 * nickname.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NEVER TRUST THE ROW — and here the boundary can do something unusual
 * ───────────────────────────────────────────────────────────────────────────
 * `league_weeks` is readable by every signed-in user (that IS the sharing
 * mechanism — see `supabase/schema.sql`), so any authenticated client can write
 * whatever it likes into its own rows and hand them to us. `normalizeLeagueRow`
 * is therefore a hard boundary exactly like `normalizeGhost`.
 *
 * But a league row is checkable in a way a ghost is not, because stage 1 built
 * the property on purpose (`core/league.ts`, `weekScore`): the score is computed
 * from the ROUNDED components, so
 *
 *      round1(100 × (0.4·C + 0.3·Q + 0.2·L + 0.1·P))  ===  score
 *
 * holds for every honestly graded week — and for no other row. The four
 * components and the score cannot be tampered with independently: a row that
 * inflates its score fails the identity, and a row that inflates a component to
 * match has to inflate a component the UI shows as a bar. The check is free, it
 * is exact (both sides are rounded), and it is what makes a hostile row's only
 * remaining lie "I trained more than I did" — which is a lie about a person, not
 * about arithmetic, and one the two players in a two-person league can settle
 * between themselves.
 *
 * `coin` is DERIVED from the (verified) components rather than believed, the way
 * `normalizeGhost` derives `characterLevel`: a row may not claim a 🔵 its own
 * numbers do not mint.
 */

import { BALANCE } from './balance.ts';
import {
  isMonthKey,
  isWeekKey,
  monthKeyOf,
  monthOfWeek,
  monthlyCoins,
  monthlyScore,
  weeksOfMonth,
} from './league.ts';
import { round1 } from './stats.ts';
import { addDays, round2 } from './xp.ts';
import type { LeagueWeekRecord } from '../storage/DataStore.ts';

/* ------------------------------------------------------------- the shapes */

/** One closed week as THIS device publishes it — the ledger record, keyed. */
export interface LeagueWeekUpload extends LeagueWeekRecord {
  /** The week's SUNDAY, ISO. */
  weekKey: string;
  /** The month containing the week's SATURDAY — `monthOfWeek(weekKey)`. */
  monthKey: string;
}

/**
 * One row as it comes BACK, after the boundary below has accepted it.
 *
 * `updatedAt` is the only field the client does not compute: it is the server's
 * note of when the row was written, used to break the (rare) tie described in
 * `opponentMonth` and to tell the UI how fresh a cached month is.
 */
export interface LeagueWeekRow extends LeagueWeekUpload {
  /** ms epoch of the publish, when the backend knows it. */
  updatedAt: number | null;
}

/** An opponent's month, assembled from whatever rows survived the boundary. */
export interface OpponentMonth {
  monthKey: string;
  /** weekKey -> record, keyed exactly like `game.league.weeks`. */
  weeks: Record<string, LeagueWeekRecord>;
  /** The accepted rows, oldest week first — what a table renders. */
  rows: LeagueWeekRow[];
  /** Σ of this month's accepted weekly scores (`monthlyScore`). */
  monthlyScore: number;
  /** 🔵 those weeks minted (`monthlyCoins`). */
  coins: number;
  /** Rows the boundary refused. Diagnostics only; never shown as a score. */
  rejected: number;
}

/* --------------------------------------------------------- the publish side */

/** `'2026-08'` -> `'2026-07'`. */
export function prevMonth(monthKey: string): string {
  if (!isMonthKey(monthKey)) return monthKey;
  return monthKeyOf(addDays(`${monthKey}-01`, -1));
}

/**
 * The closed weeks that are eligible to be published RIGHT NOW: every week of
 * the current and the previous month that the ledger has a grade for, oldest
 * first.
 *
 * WHY A WINDOW. The publisher compares this list against the set of weeks it has
 * already published (`sync/meta.ts`) on every cycle, which is what makes it
 * self-healing — a week closed while signed out, or on a device whose notebook
 * was wiped, is noticed and uploaded. Without a window that comparison would
 * walk (and, after a lost notebook, re-upload) every week the account ever
 * closed. Two months is the smallest window that keeps the FEATURE whole: the
 * league is monthly, and the previous month stays visible while it is being
 * settled. Anything older is history nobody is competing over any more.
 */
export function publishableWeeks(
  weeks: Readonly<Record<string, LeagueWeekRecord>>,
  today: string,
): LeagueWeekUpload[] {
  const month = monthKeyOf(today);
  const out: LeagueWeekUpload[] = [];
  for (const monthKey of [prevMonth(month), month]) {
    for (const weekKey of weeksOfMonth(monthKey)) {
      const record = weeks[weekKey];
      if (!record) continue;
      out.push({ ...record, weekKey, monthKey });
    }
  }
  return out;
}

/**
 * The CONTENT of a published week, as one short string — the publisher's
 * fingerprint, and the league's answer to `ghostHash`.
 *
 * WHY A WEEK KEY IS NOT ENOUGH. The publisher diffs the eligible weeks against
 * the ones its notebook says are already up, and a set of keys can only ever
 * answer "has this week been published at all". Since a closed week can be
 * RE-graded — a week closed from a log that was missing sessions is corrected
 * the moment they arrive (`core/league.ts` → `regradedWeeks`) — a key-only diff
 * would leave the rival reading the wrong number for ever, on a row this device
 * knows to be stale. Fingerprinting the grade makes the diff notice a week whose
 * CONTENT moved, which is the same self-healing property one level down.
 *
 * Every field a row carries is in it (the four components, the score, the 🔵 and
 * the three explaining numbers), formatted exactly as the ledger stores them, so
 * two devices holding the same record produce the same string and an unchanged
 * week is free.
 */
export function leagueRowFingerprint(week: LeagueWeekRecord): string {
  return [
    week.score,
    week.c,
    week.q,
    week.l,
    week.p,
    week.coin ? 1 : 0,
    week.volume,
    week.days,
    week.prs,
  ].join('|');
}

/* ------------------------------------------------------------ the boundary */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A column, by either name.
 *
 * The backend adapter is a DUMB PIPE (see `sync/backend.ts`): it hands back the
 * rows the database gave it, with the database's `snake_case` column names,
 * without interpreting a single value. Accepting both spellings here is what
 * lets it stay that way — and lets an in-memory backend store the exact same
 * rows Postgres would.
 */
function col(row: Record<string, unknown>, camel: string, snake: string): unknown {
  const v = row[camel];
  return v === undefined ? row[snake] : v;
}

/** A component: a real number in 0…1, rounded like the grader rounds it. */
function unit(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0 || v > 1) return null;
  return round2(v);
}

/** A non-negative count: clamped, never rejected — nothing here scores. */
function count(v: unknown, integer: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return integer ? Math.floor(v) : round2(v);
}

function millis(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * THE trust boundary: any row, from anywhere, to a week this app may display —
 * or `null`.
 *
 * Refused outright (not clamped, not guessed):
 *   * a `weekKey` that is not a real ISO date falling on a SUNDAY;
 *   * a `monthKey` that is not the month of that week's SATURDAY — the same
 *     `monthOfWeek` rule both devices grade by, so a row cannot smuggle a good
 *     week into a month it does not belong to;
 *   * an expected month (the month that was asked for) the row disagrees with;
 *   * any component outside 0…1, or a score outside 0…100 — clamping those would
 *     silently rewrite the identity the next check depends on;
 *   * a score that is not what its own components add up to (see the header).
 *
 * Clamped rather than refused: `volume`, `days`, `prs`. They are display-only —
 * no path lets them move a score — so a nonsense value becomes 0 rather than
 * throwing away a week whose GRADE verified.
 */
export function normalizeLeagueRow(raw: unknown, expectMonth?: string): LeagueWeekRow | null {
  if (!isRecord(raw)) return null;

  const weekKey = col(raw, 'weekKey', 'week_key');
  if (typeof weekKey !== 'string' || !isWeekKey(weekKey)) return null;

  const monthKey = monthOfWeek(weekKey);
  const claimed = col(raw, 'monthKey', 'month_key');
  if (typeof claimed !== 'string' || claimed !== monthKey) return null;
  if (expectMonth !== undefined && monthKey !== expectMonth) return null;

  const c = unit(raw['c']);
  const q = unit(raw['q']);
  const l = unit(raw['l']);
  const p = unit(raw['p']);
  if (c === null || q === null || l === null || p === null) return null;

  const rawScore = raw['score'];
  if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return null;
  if (rawScore < 0 || rawScore > 100) return null;
  const score = round1(rawScore);

  // THE SELF-VERIFYING PROPERTY (stage 1, `core/league.ts` → `weekScore`): the
  // score is a pure function of the four rounded components, so a row either
  // reproduces it or it is not a grade at all.
  const W = BALANCE.league.weights;
  const expected = round1(100 * (W.consistency * c + W.completion * q + W.load * l + W.prs * p));
  if (expected !== score) return null;

  return {
    weekKey,
    monthKey,
    score,
    c,
    q,
    l,
    p,
    // DERIVED, never believed — the same rule `weekScore` mints it by.
    coin: c >= BALANCE.league.coinConsistency && q >= BALANCE.league.coinCompletion,
    volume: count(raw['volume'], false),
    days: count(raw['days'], true),
    prs: count(raw['prs'], true),
    updatedAt: millis(col(raw, 'updatedAt', 'updated_at')),
  };
}

/**
 * A fetched month, assembled: normalize every row, drop what fails, and total
 * what is left with the SAME `monthlyScore` this account's own month is totalled
 * with — one function, one meaning, no second scoreboard.
 *
 * DUPLICATE WEEKS. Under the schema one account holds at most one row per week
 * (`primary key (user_id, week_key)`) and a handle belongs to one account (the
 * insert policy pins `handle` to the writer's `ghosts` row, which is unique), so
 * two rows for one week normally cannot exist. One case makes it possible:
 * somebody renames, their OLD rows outside the publish window keep the old
 * handle, and later somebody else claims that name. The newest `updated_at`
 * wins, which is the reading that is right in every case — including the boring
 * one where a row was simply republished.
 *
 * `monthlyScore` sums `weeksOfMonth(monthKey)` and nothing else, so a row for a
 * week outside the month (already refused above) could not inflate a total even
 * if it got this far.
 */
export function opponentMonth(rows: readonly unknown[], monthKey: string): OpponentMonth {
  const accepted = new Map<string, LeagueWeekRow>();
  let rejected = 0;
  for (const raw of rows) {
    const row = normalizeLeagueRow(raw, monthKey);
    if (!row) {
      rejected += 1;
      continue;
    }
    const prev = accepted.get(row.weekKey);
    if (prev && (prev.updatedAt ?? 0) >= (row.updatedAt ?? 0)) continue;
    accepted.set(row.weekKey, row);
  }

  const ordered = [...accepted.values()].sort((a, b) => (a.weekKey < b.weekKey ? -1 : 1));
  const weeks: Record<string, LeagueWeekRecord> = {};
  for (const row of ordered) {
    weeks[row.weekKey] = {
      score: row.score,
      c: row.c,
      q: row.q,
      l: row.l,
      p: row.p,
      coin: row.coin,
      volume: row.volume,
      days: row.days,
      prs: row.prs,
    };
  }

  return {
    monthKey,
    weeks,
    rows: ordered,
    monthlyScore: monthlyScore(weeks, monthKey),
    coins: monthlyCoins(weeks, monthKey),
    rejected,
  };
}

/** An empty month — what "nobody published anything" and "offline" both look like. */
export function emptyOpponentMonth(monthKey: string): OpponentMonth {
  return { monthKey, weeks: {}, rows: [], monthlyScore: 0, coins: 0, rejected: 0 };
}
