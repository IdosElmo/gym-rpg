/**
 * core/league.ts — הליגה: the monthly leaderboard fought with weekly 🔵.
 *
 * PURE, like every other module in `core/`: no DOM, no storage, no `Date.now()`.
 * `today` is always a parameter and every number below is a function of
 * `(sessions, events)` alone — which is what makes a week's grade a VALUE rather
 * than an accident of when it was computed, and what lets two devices that hold
 * the same log close the same week into semantically identical events.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE FORMULA
 * ───────────────────────────────────────────────────────────────────────────
 * One Sun–Sat week (the same week convention the streak uses, `weekStartISO`)
 * is graded on four components, each 0…1 and each RELATIVE TO THE PLAYER'S OWN
 * PLAN, so that two people running different plans can be compared at all:
 *
 *   C  consistency = distinct training days ÷ the weeklyTarget IN FORCE that
 *      week, capped at 1. The target is folded out of the log exactly the way
 *      the streak folds it (`weeklyTargetsFromEvents` / `weeklyTargetForWeek`),
 *      so a plan change is judged by the plan you were actually training under.
 *
 *   Q  completion  = completed sets ÷ planned sets, over THE DAYS TRAINED, capped
 *      at 1. "Planned" is the plan-in-force AT THAT DATE asking for the day the
 *      session says it was — so a plan edited mid-week grades Monday by Monday's
 *      plan and Thursday by Thursday's. Days NOT trained do not appear in Q at
 *      all: skipping a day is C's business, and counting it twice would punish
 *      the same absence in two components.
 *
 *   L  load        = this week's volume points ÷ the player's own rolling
 *      baseline, clamped to [0.5, 1.5] and rescaled linearly onto 0…1 (so
 *      "exactly at baseline" scores 0.5 — there is deliberately head-room above
 *      an ordinary week). Volume points are the app's existing unit
 *      (`setVolume`: kg × reps, or the reps/seconds alone for a bodyweight or
 *      timed set, completed sets only), so a plank and a bench press are on one
 *      axis and nobody has to invent kilograms.
 *
 *      THE BASELINE is the MEDIAN of the previous FOUR NON-EMPTY weeks — median,
 *      not mean, so one heroic (or one sick) week cannot move the bar much, and
 *      non-empty, so a holiday does not quietly halve the standard. With 1–3
 *      prior non-empty weeks it is the median of those. With ZERO prior weeks
 *      there is nothing to compare against and L is `loadNeutral` (0.75) — a
 *      first week is neutral-good rather than punished for having no history.
 *      A week that lifted NOTHING scores L = 0 whatever its history: no volume
 *      is not neutral.
 *
 *   P  PRs         = min(PRs that week, 3) ÷ 3. Dev-granted PRs are excluded —
 *      see the dev discipline note below.
 *
 *   weeklyScore = round1(100 × (0.4·C + 0.3·Q + 0.2·L + 0.1·P))
 *   the week mints ONE 🔵  ⇔  C ≥ 1 AND Q ≥ 0.8
 *
 * The score is computed from the ROUNDED components, so the four numbers stored
 * in the ledger reproduce the stored score exactly — which stage 2 needs when it
 * publishes a week to the other account.
 *
 * WHY THIS IS FAIR. A 4-day-a-week trainee doing many light sets and a 3-day-a-
 * week trainee doing few heavy ones both score C = Q = 1 when they execute their
 * own plan, and both sit at L = 0.5 in a steady week, so both land on 80 and both
 * take the coin. Nothing in the formula rewards writing a bigger plan: C and Q
 * are ratios against your own plan, and L is a ratio against your own past — a
 * week that doubles the load raises the bar for the weeks after it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MONTHS
 * ───────────────────────────────────────────────────────────────────────────
 * A week belongs to the month containing its SATURDAY, so the 52 weeks of a year
 * partition cleanly into months with no week counted twice and none dropped.
 * `monthlyScore` is the plain SUM of that month's weekly scores: a five-week
 * month is worth more than a four-week one, which is exactly right — it had more
 * weeks to train in, and both players share the same calendar.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DEV DISCIPLINE — the same split `core/stats.ts` documents
 * ───────────────────────────────────────────────────────────────────────────
 * Session-fed numbers (days, sets, volume) cannot be touched by a 🛠 dev grant
 * even in principle: the dev panel appends XP/energy/coin events and never
 * writes a set. Event-fed numbers (P, and the plan history) run through
 * `trainingEvents` / `liveEvents`, so a purged grant is gone and an unpurged one
 * still never moves a score.
 */

import { BUILTIN_PROGRAM, type DayKey, type ExerciseResolver, type ResolvedProgram } from '../data/program.ts';
import { leagueItemById, poolOfMonth, priceOf, type LeagueItemKind } from '../data/leaguePools.ts';
import type { PlanDoc } from '../data/planTypes.ts';
import type {
  AppEvent,
  GameState,
  LeagueChallengeCompletedPayload,
  LeagueChallengeSetPayload,
  LeagueRewardRedeemedPayload,
  LeagueState,
  LeagueWeekClosedPayload,
  LeagueWeekRecord,
  Session,
} from '../storage/DataStore.ts';
import { BALANCE } from './balance.ts';
import { makeResolver, normalizePlanDoc, resolveProgram } from './plan.ts';
import { completedSets, round1, trainingEvents } from './stats.ts';
import {
  addDays,
  clamp,
  isoToTs,
  liveEvents,
  monthOfWeekISO,
  round2,
  weekEndISO,
  weekStartISO,
  weeklyTargetForWeek,
  weeklyTargetsFromEvents,
  type PendingEvent,
  type WeeklyTargets,
} from './xp.ts';

/* ------------------------------------------------------- week & month keys */

/**
 * THE key of the week a date belongs to: the ISO date of its SUNDAY.
 *
 * Deliberately the same function the streak uses, so "a week" means exactly one
 * thing in this app and a league week can never be off by a day from a streak
 * week.
 */
export function weekKeyOf(date: string): string {
  return weekStartISO(date);
}

/** The SATURDAY that closes a week — the day that decides its month. */
export function weekEndOf(weekKey: string): string {
  return weekEndISO(weekKey);
}

/** True for a well-formed week key: a real ISO date that IS a Sunday. */
export function isWeekKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && weekStartISO(value) === value;
}

/** `'2026-08-25'` -> `'2026-08'`. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * The month a WEEK belongs to — the one containing its Saturday.
 *
 * Defined in `core/xp.ts` next to `weekStartISO`, because the reducer's derived
 * monthly totals need the identical rule and the two must never drift apart.
 */
export function monthOfWeek(weekKey: string): string {
  return monthOfWeekISO(weekKey);
}

/** True for a well-formed `'YYYY-MM'` key. */
export function isMonthKey(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const m = Number(value.slice(5, 7));
  return m >= 1 && m <= 12;
}

/**
 * Every week of a month, oldest first — i.e. every week whose SATURDAY falls in
 * it. Four or five entries, and the union over the months of a year is exactly
 * the weeks of that year.
 */
export function weeksOfMonth(monthKey: string): string[] {
  if (!isMonthKey(monthKey)) return [];
  const first = `${monthKey}-01`;
  const dow = new Date(isoToTs(first)).getUTCDay();
  let saturday = addDays(first, (6 - dow + 7) % 7);
  const out: string[] = [];
  while (saturday.startsWith(monthKey)) {
    out.push(addDays(saturday, -6));
    saturday = addDays(saturday, 7);
  }
  return out;
}

/* ------------------------------------------------------- the plan history */

/** The plan in force from `ts` on, already resolved into a program. */
interface PlanPoint {
  ts: number;
  plan: PlanDoc | null;
  program: ResolvedProgram;
  /** day key -> planned sets, memoised (a program is walked once, not per day). */
  planned: Map<DayKey, number>;
}

function plannedOfProgram(program: ResolvedProgram): Map<DayKey, number> {
  const out = new Map<DayKey, number>();
  for (const day of program.days) {
    let sets = 0;
    for (const ex of day.day.exercises) sets += Math.max(0, Math.floor(ex.sets));
    out.set(day.key, sets);
  }
  return out;
}

function planPoint(ts: number, plan: PlanDoc | null): PlanPoint {
  const program = resolveProgram(plan);
  return { ts, plan, program, planned: plannedOfProgram(program) };
}

/**
 * The plan's history over time, ascending — the same fold `planFromEvents` does,
 * kept as a TIMELINE rather than collapsed to its last value.
 *
 * The league needs "what did the plan ask for on the day this session was
 * logged", which is a question about the past; folding to the current document
 * would grade March against August's plan. `data_cleared` puts the built-in
 * program back, exactly as it does everywhere else.
 *
 * The list always opens with the built-in program at `-∞`, so there is a plan in
 * force at every instant and no caller ever has to handle "before the first
 * plan event".
 */
function planHistory(ordered: readonly AppEvent[]): PlanPoint[] {
  const out: PlanPoint[] = [
    { ts: Number.NEGATIVE_INFINITY, plan: null, program: BUILTIN_PROGRAM, planned: plannedOfProgram(BUILTIN_PROGRAM) },
  ];
  for (const ev of ordered) {
    if (ev.type === 'plan_updated') out.push(planPoint(ev.ts, normalizePlanDoc(ev.payload['plan'])));
    else if (ev.type === 'data_cleared') out.push(planPoint(ev.ts, null));
  }
  return out;
}

function planAt(history: readonly PlanPoint[], ts: number): PlanPoint {
  let found = history[0] as PlanPoint;
  for (const point of history) {
    if (point.ts > ts) break;
    found = point;
  }
  return found;
}

/** The instant a DATE ends — a plan saved that morning is in force for it. */
function endOfDay(date: string): number {
  return isoToTs(addDays(date, 1)) - 1;
}

/* ---------------------------------------------------------------- context */

/** What one week actually contains, before any grading. */
export interface WeekAggregate {
  /** Distinct dates with at least one completed set. */
  days: number;
  /** Completed sets, over those days. */
  sets: number;
  /** Sets the plan-in-force asked for, over THOSE SAME days. */
  planned: number;
  /** Volume points (`setVolume`) over those days. */
  volume: number;
  /** PRs (dev grants excluded), uncapped. */
  prs: number;
}

const EMPTY_WEEK: WeekAggregate = { days: 0, sets: 0, planned: 0, volume: 0, prs: 0 };

export interface LeagueInput {
  sessions: Readonly<Record<string, Session>>;
  events: readonly AppEvent[];
  /**
   * Plan-aware exercise lookup. Optional: the context derives one from the log's
   * own final plan, which is what makes the whole engine a function of
   * `(sessions, events)` and nothing else.
   */
  resolve?: ExerciseResolver;
}

/**
 * Everything the grader needs, computed ONCE over the whole history.
 *
 * A context is a pure function of `(sessions, events)`: build it, then ask it
 * for any week or month. Grading a 26-week backfill therefore walks the
 * sessions once rather than 26 times.
 */
export interface LeagueContext {
  /** weekKey -> what that week contains. Only weeks with training appear. */
  readonly weeks: ReadonlyMap<string, WeekAggregate>;
  /** Week keys with volume > 0, ascending — the baseline's source. */
  readonly loaded: readonly string[];
  /** The plan's weekly-target history, folded exactly like the streak's. */
  readonly targets: WeeklyTargets;
  /** First date with a completed set — where a backfill may start. */
  readonly firstDate: string | null;
}

/**
 * PRs per week, from the event log.
 *
 * Deduped by `(date, exercise, set)` — the same key the game's own `prKeys`
 * ledger uses — so a merged log that carries the same record twice counts it
 * once, and reset by `data_cleared` exactly like `gameStats` resets its totals.
 */
function prsByWeek(events: readonly AppEvent[]): Map<string, number> {
  const seen = new Set<string>();
  const perWeek = new Map<string, number>();
  for (const ev of trainingEvents(events)) {
    if (ev.type === 'data_cleared') {
      seen.clear();
      perWeek.clear();
      continue;
    }
    if (ev.type !== 'pr_achieved') continue;
    const p = ev.payload;
    const date = typeof p['date'] === 'string' ? p['date'] : '';
    if (!date) continue;
    const key = `${date}|${typeof p['exId'] === 'string' ? p['exId'] : ''}|${
      typeof p['setIndex'] === 'number' ? p['setIndex'] : -1
    }`;
    if (seen.has(key)) continue;
    seen.add(key);
    const week = weekKeyOf(date);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  return perWeek;
}

/** Build the grading context. Pure; safe to call as often as you like. */
export function leagueContext(input: LeagueInput): LeagueContext {
  const ordered = liveEvents(input.events);
  const history = planHistory(ordered);
  const last = history[history.length - 1] as PlanPoint;
  const resolve = input.resolve ?? makeResolver(last.plan);
  const sets = completedSets(input.sessions, resolve);

  /* one pass over the sets -> per DATE, because "planned" is a per-date fact */
  const byDate = new Map<string, { sets: number; volume: number }>();
  for (const s of sets) {
    const d = byDate.get(s.date) ?? { sets: 0, volume: 0 };
    d.sets += 1;
    d.volume += s.volume;
    byDate.set(s.date, d);
  }

  const weeks = new Map<string, WeekAggregate>();
  const dates = [...byDate.keys()].sort();
  for (const date of dates) {
    const day = byDate.get(date) as { sets: number; volume: number };
    const point = planAt(history, endOfDay(date));
    const dayKey = input.sessions[date]?.day ?? '';
    // A day the plan-in-force no longer describes (deleted, or invented on
    // another device) cannot say how many sets it wanted — so it is graded
    // against what was actually done, which neither rewards nor punishes it.
    const planned = point.planned.get(dayKey) ?? day.sets;

    const week = weekKeyOf(date);
    const agg = weeks.get(week) ?? { ...EMPTY_WEEK };
    agg.days += 1;
    agg.sets += day.sets;
    agg.planned += planned;
    agg.volume = round2(agg.volume + day.volume);
    weeks.set(week, agg);
  }

  const prs = prsByWeek(input.events);
  for (const [week, count] of prs) {
    const agg = weeks.get(week);
    // A week with PRs but no sessions cannot exist in practice (a PR is written
    // by a set), but a hand-edited log could say so — it is graded as a week
    // with no training, which is what its sessions say.
    if (agg) agg.prs = count;
  }

  const loaded = [...weeks.entries()]
    .filter(([, agg]) => agg.volume > 0)
    .map(([week]) => week)
    .sort();

  return {
    weeks,
    loaded,
    targets: weeklyTargetsFromEvents(ordered),
    firstDate: dates[0] ?? null,
  };
}

/* ---------------------------------------------------------------- scoring */

/** The median of a list of numbers (even count -> mean of the two middle). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return round2(value);
}

/**
 * The rolling load baseline for a week: the median of the previous up-to-four
 * NON-EMPTY weeks. `0` means "no history at all" — see `loadScore`.
 */
export function baselineFor(ctx: LeagueContext, weekKey: string): number {
  const prior = ctx.loaded.filter((w) => w < weekKey).slice(-BALANCE.league.baselineWeeks);
  return median(prior.map((w) => (ctx.weeks.get(w) as WeekAggregate).volume));
}

/**
 * L from a week's volume and its baseline.
 *
 * Nothing lifted is 0, never neutral. No baseline (the player's first week) is
 * `loadNeutral`. Otherwise the ratio is clamped and rescaled, so being exactly
 * on your own baseline is 0.5 and being 50% above it is 1.
 */
export function loadScore(volume: number, baseline: number): number {
  const B = BALANCE.league;
  if (volume <= 0) return 0;
  if (baseline <= 0) return B.loadNeutral;
  const ratio = clamp(volume / baseline, B.loadRatioMin, B.loadRatioMax);
  return round2((ratio - B.loadRatioMin) / (B.loadRatioMax - B.loadRatioMin));
}

/** A graded week: the ledger record plus everything the UI wants to explain it. */
export interface WeekScore extends LeagueWeekRecord {
  weekKey: string;
  /** The week's Saturday. */
  weekEnd: string;
  monthKey: string;
  /** The weekly target in force that week — C's denominator. */
  target: number;
  /** Q's two halves, for "12 מתוך 16 סטים". */
  completedSets: number;
  plannedSets: number;
  /** The rolling baseline L was measured against (0 when there was none). */
  baseline: number;
}

/**
 * GRADE ONE WEEK. The heart of the feature; everything else is bookkeeping.
 *
 * A week with no training day at all is a flat zero — including L, because "no
 * baseline yet" only excuses a week that actually trained.
 */
export function weekScore(ctx: LeagueContext, weekKey: string): WeekScore {
  const B = BALANCE.league;
  const agg = ctx.weeks.get(weekKey) ?? EMPTY_WEEK;
  const target = Math.max(1, weeklyTargetForWeek(ctx.targets, weekKey));
  const baseline = baselineFor(ctx, weekKey);

  const c = round2(clamp(agg.days / target, 0, 1));
  const q = round2(agg.planned > 0 ? clamp(agg.sets / agg.planned, 0, 1) : 0);
  const l = agg.days > 0 ? loadScore(agg.volume, baseline) : 0;
  const p = round2(clamp(agg.prs / B.prTarget, 0, 1));

  // Scored from the ROUNDED components on purpose: the four numbers in the
  // ledger must reproduce the stored score exactly, on this device and on the
  // one that will read them over the wire in stage 2.
  const score = round1(
    100 * (B.weights.consistency * c + B.weights.completion * q + B.weights.load * l + B.weights.prs * p),
  );

  return {
    weekKey,
    weekEnd: weekEndOf(weekKey),
    monthKey: monthOfWeek(weekKey),
    score,
    c,
    q,
    l,
    p,
    coin: c >= B.coinConsistency && q >= B.coinCompletion,
    volume: agg.volume,
    days: agg.days,
    prs: agg.prs,
    target,
    completedSets: agg.sets,
    plannedSets: agg.planned,
    baseline,
  };
}

/** The week `today` is in, graded as it stands right now — the live card. */
export function liveWeek(ctx: LeagueContext, today: string): WeekScore {
  return weekScore(ctx, weekKeyOf(today));
}

/* ------------------------------------------------------------- the months */

/** Σ of a month's CLOSED weekly scores. */
export function monthlyScore(weeks: Readonly<Record<string, LeagueWeekRecord>>, monthKey: string): number {
  let total = 0;
  for (const week of weeksOfMonth(monthKey)) total += weeks[week]?.score ?? 0;
  return round1(total);
}

/** 🔵 a month's closed weeks minted. */
export function monthlyCoins(weeks: Readonly<Record<string, LeagueWeekRecord>>, monthKey: string): number {
  let coins = 0;
  for (const week of weeksOfMonth(monthKey)) if (weeks[week]?.coin) coins += BALANCE.league.coinPerWeek;
  return coins;
}

/**
 * The month as it stands RIGHT NOW: the closed weeks plus the week in progress.
 *
 * The in-progress week is graded but not closed, so the number moves as the week
 * is trained — which is the whole point of showing it.
 */
export function monthProgress(
  ctx: LeagueContext,
  league: LeagueState,
  today: string,
): { month: string; closed: number; live: number; total: number; coins: number; liveWeek: WeekScore } {
  const month = monthKeyOf(today);
  const closed = monthlyScore(league.weeks, month);
  const live = liveWeek(ctx, today);
  const counted = monthOfWeek(live.weekKey) === month && !league.weeks[live.weekKey];
  return {
    month,
    closed,
    live: counted ? live.score : 0,
    total: round1(closed + (counted ? live.score : 0)),
    coins: monthlyCoins(league.weeks, month),
    liveWeek: live,
  };
}

/* --------------------------------------------------------- closing weeks */

/**
 * The finished weeks this log has NOT closed yet, oldest first.
 *
 * Weeks close by the passing of time rather than by anything the user does, so
 * something has to notice — the same job `refreshStreak` does for the tier. The
 * window runs from the week of the FIRST logged set to the week before the one
 * containing `today` (a week in progress is never graded), and reaches back at
 * most `BALANCE.league.backfillWeeks` weeks so an install that was closed for a
 * year cannot write a year of events on its next boot.
 */
export function dueWeeks(ctx: LeagueContext, league: LeagueState, today: string): string[] {
  if (!ctx.firstDate) return [];
  const currentWeek = weekKeyOf(today);
  const earliest = addDays(currentWeek, -7 * BALANCE.league.backfillWeeks);
  const firstWeek = weekKeyOf(ctx.firstDate);
  let week = firstWeek > earliest ? firstWeek : earliest;
  const out: string[] = [];
  // 5200 = a century of weeks; a corrupt date can never make this endless.
  for (let guard = 0; week < currentWeek && guard < 5200; guard += 1) {
    if (!league.weeks[week]) out.push(week);
    week = addDays(week, 7);
  }
  return out;
}

/**
 * Weeks the ledger has ALREADY closed that this log now grades HIGHER, oldest
 * first — the self-heal, and the other half of `buildWeekCloses`.
 *
 * WHY A CLOSED WEEK IS EVER RE-GRADED. A close is a function of the log the
 * device held AT THE MOMENT IT CLOSED, and a device can hold less than the
 * account does: a fresh install signs in, boots, grades the finished weeks from
 * a log the first pull has not filled yet, and files a 55 with no 🔵 for a week
 * that was trained four days out of four and deserved 80. The sessions arrive seconds later — and under a
 * first-wins ledger nothing could ever act on them. So the grade is re-derived
 * from the log as it stands now, and when the log has MORE to say than the
 * ledger does, a corrective close is appended.
 *
 * STRICTLY HIGHER, NEVER LOWER, and the asymmetry is the point: data arrives, it
 * does not depart. A device whose log was pruned (or that pulled only part of
 * the account) must not be able to erase a 🔵 somebody earned; the reducer
 * enforces the same rule a second time, so neither a crafted event nor a stale
 * device can downgrade a week. The cost is that a grade inflated by a genuinely
 * partial log is never walked back — accepted, and cheap: the components that
 * dominate the score (C and Q, 70% of it) can only ever RISE as sessions arrive.
 *
 * It terminates: once the correction is folded the ledger equals the recompute,
 * so the next call finds nothing and `closeDueWeeks` stays idempotent.
 */
export function regradedWeeks(ctx: LeagueContext, league: LeagueState, today: string): string[] {
  if (!ctx.firstDate) return [];
  const currentWeek = weekKeyOf(today);
  const earliest = addDays(currentWeek, -7 * BALANCE.league.backfillWeeks);
  const firstWeek = weekKeyOf(ctx.firstDate);
  let week = firstWeek > earliest ? firstWeek : earliest;
  const out: string[] = [];
  for (let guard = 0; week < currentWeek && guard < 5200; guard += 1) {
    const filed = league.weeks[week];
    if (filed && weekScore(ctx, week).score > filed.score) out.push(week);
    week = addDays(week, 7);
  }
  return out;
}

/** The payload one closed week writes. */
export function weekClosedPayload(score: WeekScore, date: string): LeagueWeekClosedPayload {
  return {
    weekKey: score.weekKey,
    date,
    score: score.score,
    c: score.c,
    q: score.q,
    l: score.l,
    p: score.p,
    coin: score.coin,
    volume: score.volume,
    days: score.days,
    prs: score.prs,
  };
}

/**
 * The events that close every due week — the pure half of the driver.
 *
 * Deterministic in every detail: the weeks come out oldest first and each is
 * graded from the log alone, so two devices that hold the same events produce
 * the same payloads. They will carry different uuids (and probably different
 * timestamps), and that is fine: the reducer keeps the first in the `(ts, id)`
 * order and the rest are no-ops, so the union converges on one grade and one 🔵
 * whichever way it is merged.
 *
 * A week is closed even when NOTHING was trained in it: a zero is a fact about
 * the month, and a ledger with holes could not tell "not closed yet" from
 * "closed empty".
 *
 * AND IT RE-CLOSES what the log now grades higher (`regradedWeeks`): a week
 * graded from an incomplete log is corrected the moment the rest of the log
 * arrives, which is what the ledger's best-grade rule exists to accept. Both
 * lists come out oldest first and share one ascending `ts` run, so the events
 * are as deterministic as before — two devices holding the same log still emit
 * semantically identical payloads.
 */
export function buildWeekCloses(
  input: LeagueInput,
  league: LeagueState,
  today: string,
  ts: number,
): PendingEvent[] {
  const ctx = leagueContext(input);
  const out: PendingEvent[] = [];
  let offset = 0;
  const weeks = [...dueWeeks(ctx, league, today), ...regradedWeeks(ctx, league, today)].sort();
  for (const week of weeks) {
    out.push({
      type: 'league_week_closed',
      payload: weekClosedPayload(weekScore(ctx, week), today),
      ts: ts + offset,
    });
    offset += 1;
  }
  return out;
}

/* --------------------------------------------------- spending the coins */

/** Why a 🔵 spend was refused — the UI turns this into Hebrew. */
export type LeagueSpendError =
  | 'unknown_item'
  | 'wrong_month'
  | 'already_redeemed'
  | 'challenge_already_set'
  | 'no_challenge'
  | 'already_completed'
  | 'insufficient_coins';

export interface LeagueSpendPlan {
  ok: boolean;
  error?: LeagueSpendError;
  /** 🔵 the plan would charge (0 when refused). */
  cost: number;
  events: PendingEvent[];
}

const REFUSED = (error: LeagueSpendError): LeagueSpendPlan => ({ ok: false, error, cost: 0, events: [] });

/** The ledger key of one redemption. */
export function redemptionKey(month: string, itemId: string): string {
  return `${month}|${itemId}`;
}

/**
 * Plan a redemption. PURE: it decides, it does not spend.
 *
 * Every refusal is checked HERE, before anything reaches the log, exactly like
 * `buildPurchase` — so a redemption that cannot happen leaves no trace and a
 * replay can never produce a negative purse. The "once per month" half is
 * enforced twice on purpose: here so the UI can explain it, and again in the
 * reducer so a duplicated or crafted event cannot buy a second one.
 *
 * WHAT IS NOT CHECKED HERE: whether this account WON the month. That is a
 * cross-account fact — it depends on the opponent's scores, which are not in
 * this log — so it belongs to the UI + social-contract layer (stages 3/4), not
 * to a fold that has to converge from the event set alone.
 */
export function buildLeagueRedemption(
  game: GameState,
  month: string,
  itemId: string,
  date: string,
  ts: number,
): LeagueSpendPlan {
  if (!isMonthKey(month)) return REFUSED('wrong_month');
  const item = leagueItemById(itemId);
  if (!item || item.kind === 'challenge') return REFUSED('unknown_item');
  const pool = poolOfMonth(month);
  if (!pool.rewards.some((i) => i.id === itemId)) return REFUSED('wrong_month');
  if (game.league.redemptions[redemptionKey(month, itemId)]) return REFUSED('already_redeemed');
  const cost = priceOf(item.kind);
  if (game.league.coins < cost) return REFUSED('insufficient_coins');

  const payload: LeagueRewardRedeemedPayload = { month, itemId, kind: item.kind, cost, date };
  return { ok: true, cost, events: [{ type: 'league_reward_redeemed', payload, ts }] };
}

/**
 * Plan staking a month's challenge. One slot per month, paid for up front —
 * same contract as a redemption, one field narrower.
 */
export function buildLeagueChallengeSet(
  game: GameState,
  month: string,
  challengeId: string,
  date: string,
  ts: number,
): LeagueSpendPlan {
  if (!isMonthKey(month)) return REFUSED('wrong_month');
  const item = leagueItemById(challengeId);
  if (!item || item.kind !== 'challenge') return REFUSED('unknown_item');
  if (!poolOfMonth(month).challenges.some((i) => i.id === challengeId)) return REFUSED('wrong_month');
  if (game.league.challenges[month]) return REFUSED('challenge_already_set');
  const cost = priceOf('challenge');
  if (game.league.coins < cost) return REFUSED('insufficient_coins');

  const payload: LeagueChallengeSetPayload = { month, challengeId, cost, date };
  return { ok: true, cost, events: [{ type: 'league_challenge_set', payload, ts }] };
}

/**
 * Plan claiming a month's challenge as done. Self-reported in v1: the check is
 * that a challenge IS staked for that month and has not been claimed yet — the
 * app has no way to verify "10 pull-ups in a row", and pretending otherwise
 * would be theatre.
 */
export function buildLeagueChallengeComplete(
  game: GameState,
  month: string,
  date: string,
  ts: number,
): LeagueSpendPlan {
  if (!isMonthKey(month)) return REFUSED('wrong_month');
  const stake = game.league.challenges[month];
  if (!stake) return REFUSED('no_challenge');
  const item = leagueItemById(stake.challengeId);
  if (!item) return REFUSED('unknown_item');
  if (game.league.completions[completionKey(month, stake.challengeId)] !== undefined) {
    return REFUSED('already_completed');
  }
  const bonus = clamp(item.bonus, 0, BALANCE.league.maxBonus);
  const payload: LeagueChallengeCompletedPayload = { month, challengeId: stake.challengeId, bonus, date };
  // A completion PAYS, it does not charge — `cost` stays 0 and the bonus rides
  // in the payload, capped here and capped again by the reducer.
  return { ok: true, cost: 0, events: [{ type: 'league_challenge_completed', payload, ts }] };
}

/** The ledger key of one challenge completion. */
export function completionKey(month: string, challengeId: string): string {
  return `${month}|${challengeId}`;
}

/** The 🔵 price of a pool item kind — re-exported so the UI needs one import. */
export function leaguePrice(kind: LeagueItemKind): number {
  return priceOf(kind);
}
