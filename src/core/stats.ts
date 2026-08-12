/**
 * core/stats.ts — every number the 📊 סטטיסטיקות screen shows, as PURE
 * functions. No DOM, no `Date.now()`, no store: `today` is always passed in and
 * the whole module is a function of `(sessions, events, resolve, today)`.
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH METRIC COMES FROM — and what that means for 🛠 dev grants
 * ---------------------------------------------------------------------------
 * There are exactly TWO sources in this app, and the split is what makes the
 * dev-exclusion rule trivial to state rather than a pile of special cases:
 *
 *   1. THE SESSIONS — the logged sets themselves. Everything about TRAINING is
 *      computed from here: tonnage, sets, reps, plank seconds, the weekly
 *      sparkline, the calendar heatmap, the per-body-part balance, the
 *      per-exercise bests and every oddball but the XP-efficiency one.
 *      A dev grant cannot touch these numbers even in principle: the dev panel
 *      appends `xp_gained` / `energy_gained` / `coins_granted` events and NEVER
 *      writes a set. So "exclude dev from training metrics" is satisfied by
 *      construction here — which is exactly why the training metrics are read
 *      from the sessions rather than from the (equally available) XP events.
 *
 *   2. THE EVENT LOG — for the things that only exist as events: PRs, streak
 *      tiers, waves/bosses/dailies/duels, lifetime coins and energy, total XP.
 *      Here dev events are REAL events in the log, so the exclusion has to be
 *      done on purpose. Two filters, both applied by `trainingEvents`:
 *        * `liveEvents` (core/xp.ts) drops every dev grant a `dev_purge` took
 *          back — the same pre-pass the game state itself folds through, so the
 *          stats screen and the character screen can never disagree;
 *        * anything still carrying `payload.dev === true` is dropped as well,
 *          so a grant that has NOT been purged still never inflates a lifetime
 *          total. `coins_granted` (a dev-only event type) is dropped whole.
 *      What is deliberately NOT dropped: a real wave cleared with dev energy.
 *      That fight happened; the purge itself reverts grants, not history.
 *
 * COMPLETED SETS ONLY. Every training metric counts a set only once its ✓ is
 * on (`done === true`). A weight typed into a row that was never checked is an
 * intention, not a lift — and it is also the exact rule the XP engine uses to
 * pay, so "סה"כ הרמתם" can never disagree with what the character was paid for.
 *
 * WEIGHTS ARE STRINGS ("42.5", "", "abc") — parsed defensively through
 * `toNumber`, and bodyweight / timed exercises (unit שניות or חזרות) contribute
 * REPS and SECONDS, never kilograms.
 */

import {
  BODY_PARTS,
  bodyPartWeights,
  type BodyPart,
  type Exercise,
  type ExerciseResolver,
} from '../data/program.ts';
import type { AppEvent, Session, SetEntry } from '../storage/DataStore.ts';
import { addDays, isoToTs, liveEvents, setVolume, toNumber, weekStartISO } from './xp.ts';

/* ------------------------------------------------------------- primitives */

/** Rest assumed for an exercise the plan no longer resolves (seconds). */
export const DEFAULT_REST_SEC = 60;

/** Game ⚡ that "charges a phone" once — a cute constant, not physics. */
export const ENERGY_PER_PHONE_CHARGE = 250;

/** Weeks drawn by the weekly sparkline and by the calendar heatmap. */
export const SPARK_WEEKS = 12;
export const HEATMAP_WEEKS = 16;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Round to one decimal — the precision every headline on the screen uses. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** True for an exercise logged in SECONDS (plank & friends). */
export function isTimed(ex: Exercise | null): boolean {
  return !!ex && ex.unit.includes('שניות');
}

/** Weekday of an ISO date, `Date#getDay()`-style (0 = Sunday), UTC-anchored. */
export function weekdayOf(date: string): number {
  return new Date(isoToTs(date)).getUTCDay();
}

/** Whole days between two ISO dates (`to − from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((isoToTs(to) - isoToTs(from)) / 86_400_000);
}

/* ------------------------------------------------------------ logged sets */

/** ONE completed set, already parsed and resolved — the unit of every total. */
export interface SetStat {
  date: string;
  exId: string;
  /** Hebrew name, or the raw id when the plan can no longer resolve it. */
  he: string;
  /** The resolved definition, or `null` for an id nothing knows any more. */
  ex: Exercise | null;
  /** Parsed weight in kg (0 for a bodyweight or timed set). */
  weight: number;
  /** Parsed second field: repetitions, or SECONDS on a timed exercise. */
  reps: number;
  timed: boolean;
  /** `weight × reps` — kilograms actually moved. 0 whenever weight is 0. */
  tonnage: number;
  /**
   * The app's own volume unit (`core/xp.ts#setVolume`): tonnage for a weighted
   * set, the reps or seconds alone for a bodyweight / timed one. This is what
   * PRs, XP and the per-part balance are measured in, so a plank and a bench
   * press are comparable on one axis without inventing fake kilograms.
   */
  volume: number;
  /** The exercise's prescribed rest, for the "time under the rest timer" toy. */
  rest: number;
}

/**
 * Every COMPLETED set in the log of sessions, oldest first.
 *
 * Sparse `null` holes in a session's set array (the legacy on-demand format)
 * and an unchecked row are both simply skipped.
 */
export function completedSets(
  sessions: Readonly<Record<string, Session>>,
  resolve: ExerciseResolver,
): SetStat[] {
  const out: SetStat[] = [];
  for (const date of Object.keys(sessions).sort()) {
    const session = sessions[date];
    if (!session) continue;
    for (const exId of Object.keys(session.ex)) {
      const arr = session.ex[exId] ?? [];
      const ex = resolve(exId);
      const timed = isTimed(ex);
      for (const raw of arr) {
        const set: SetEntry | null = raw ?? null;
        if (!set || set.done !== true) continue;
        const weight = Math.max(0, toNumber(set.w));
        const reps = Math.max(0, toNumber(set.r));
        out.push({
          date,
          exId,
          he: ex ? ex.he : exId,
          ex,
          weight,
          reps,
          timed,
          tonnage: weight > 0 && reps > 0 ? Math.round(weight * reps * 100) / 100 : 0,
          volume: setVolume(set.w, set.r),
          rest: ex ? ex.rest : DEFAULT_REST_SEC,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ the basics */

export interface Basics {
  /** Σ weight×reps over completed sets, in kilograms. */
  tonnage: number;
  /** Distinct dates that have at least one completed set. */
  workouts: number;
  sets: number;
  /** Repetitions of every non-timed set. */
  reps: number;
  /** Seconds held on timed (plank-style) exercises. */
  seconds: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Workout count per weekday, `Date#getDay()` order (0 = Sunday). */
  byWeekday: readonly number[];
  /** Busiest weekday, or `null` with no workouts at all. */
  topWeekday: number | null;
  /** Workouts ÷ weeks since the first one (one decimal, ≥ 0). */
  perWeek: number;
}

export function basics(sets: readonly SetStat[], today: string): Basics {
  const days = new Set<string>();
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  let tonnage = 0;
  let reps = 0;
  let seconds = 0;

  for (const s of sets) {
    tonnage += s.tonnage;
    if (s.timed) seconds += s.reps;
    else reps += s.reps;
    days.add(s.date);
  }

  const dates = [...days].sort();
  for (const d of dates) {
    const wd = weekdayOf(d);
    byWeekday[wd] = (byWeekday[wd] ?? 0) + 1;
  }

  const first = dates[0] ?? null;
  const last = dates[dates.length - 1] ?? null;
  // The span is measured to TODAY, not to the last workout: three weeks off is
  // part of the average, and hiding that would flatter the number.
  const span = first ? Math.max(1, daysBetween(first, today) + 1) : 0;
  const weeks = span > 0 ? span / 7 : 0;

  let topWeekday: number | null = null;
  for (let wd = 0; wd < 7; wd += 1) {
    if ((byWeekday[wd] ?? 0) > 0 && (topWeekday === null || (byWeekday[wd] ?? 0) > (byWeekday[topWeekday] ?? 0))) {
      topWeekday = wd;
    }
  }

  return {
    tonnage: Math.round(tonnage * 100) / 100,
    workouts: dates.length,
    sets: sets.length,
    reps,
    seconds,
    firstDate: first,
    lastDate: last,
    byWeekday,
    topWeekday,
    perWeek: weeks > 0 ? round1(dates.length / Math.max(1, weeks)) : 0,
  };
}

/* -------------------------------------------------------- fun equivalents */

/** ONE thing the total tonnage can be compared to. */
export interface Equivalent {
  readonly id: string;
  readonly emoji: string;
  /** Hebrew name in the SINGULAR ("פיל אפריקאי"). */
  readonly he: string;
  /** Hebrew PLURAL for the count line ("פילים אפריקאיים"). */
  readonly plural: string;
  readonly kg: number;
}

/**
 * The ladder, lightest first. It starts small on purpose: a first workout is a
 * few hundred kilograms, and a scale whose smallest rung is an elephant would
 * read "0.0 פילים" for the first month — which is the opposite of encouraging.
 */
export const EQUIVALENTS: readonly Equivalent[] = [
  { id: 'gorilla', emoji: '🦍', he: 'גורילת הרים', plural: 'גורילות', kg: 160 },
  { id: 'cow', emoji: '🐄', he: 'פרה', plural: 'פרות', kg: 750 },
  { id: 'car', emoji: '🚗', he: 'מכונית משפחתית', plural: 'מכוניות', kg: 1_400 },
  { id: 'elephant', emoji: '🐘', he: 'פיל אפריקאי', plural: 'פילים אפריקאיים', kg: 6_000 },
  { id: 'bus', emoji: '🚌', he: 'אוטובוס', plural: 'אוטובוסים', kg: 12_000 },
  { id: 'whale', emoji: '🐋', he: 'לווייתן כחול', plural: 'לווייתנים כחולים', kg: 150_000 },
  { id: 'eiffel', emoji: '🗼', he: 'מגדל אייפל', plural: 'מגדלי אייפל', kg: 10_100_000 },
] as const;

/** One rung with how many of it the total is worth. */
export interface EquivalentCount {
  eq: Equivalent;
  /** `kg / eq.kg`, one decimal. */
  count: number;
  /** True once the rung has been passed at least once. */
  reached: boolean;
}

export interface EquivalentsResult {
  /** Every rung, lightest first — the list under the headline. */
  all: EquivalentCount[];
  /** The HEAVIEST rung already passed — the one the headline brags about. */
  headline: EquivalentCount | null;
  /** The next rung and the kilograms still missing, or `null` at the top. */
  next: { eq: Equivalent; remaining: number } | null;
}

/**
 * Turn kilograms into the fun ladder.
 *
 * The headline is the heaviest rung ALREADY PASSED (count ≥ 1) — never a
 * rounded-up "1.0 אוטובוס" for 11,900 kg — and `next` is the first rung that is
 * still out of reach, so the screen can always say "עוד X ק"ג ל…".
 */
export function equivalentsOf(kg: number): EquivalentsResult {
  const total = Math.max(0, kg);
  const all = EQUIVALENTS.map((eq) => ({
    eq,
    count: round1(total / eq.kg),
    reached: total >= eq.kg,
  }));
  let headline: EquivalentCount | null = null;
  for (const item of all) if (item.reached) headline = item;
  const nextEq = EQUIVALENTS.find((eq) => total < eq.kg);
  return {
    all,
    headline,
    next: nextEq ? { eq: nextEq, remaining: Math.max(0, Math.round((nextEq.kg - total) * 10) / 10) } : null,
  };
}

/* ------------------------------------------------------- weekly sparkline */

/** ONE Sun–Sat week of the sparkline. */
export interface WeekPoint {
  /** ISO date of the Sunday that opens the week. */
  weekStart: string;
  tonnage: number;
  sets: number;
  workouts: number;
  /** True for the week `today` falls in — the one that is still running. */
  current: boolean;
}

/**
 * Tonnage per calendar week for the last `weeks` weeks, OLDEST FIRST.
 *
 * Weeks are Sun–Sat (`weekStartISO`, UTC-anchored like every other date in this
 * app), the series is CONTIGUOUS — a week with no training is a real zero, not
 * a gap, or the line would lie about consistency — and the last point is always
 * the week containing `today`, however stale the log is.
 */
export function weeklyTonnage(
  sets: readonly SetStat[],
  today: string,
  weeks: number = SPARK_WEEKS,
): WeekPoint[] {
  const span = Math.max(1, Math.floor(weeks));
  const currentWeek = weekStartISO(today);
  const buckets = new Map<string, { tonnage: number; sets: number; days: Set<string> }>();
  for (const s of sets) {
    const key = weekStartISO(s.date);
    const b = buckets.get(key) ?? { tonnage: 0, sets: 0, days: new Set<string>() };
    b.tonnage += s.tonnage;
    b.sets += 1;
    b.days.add(s.date);
    buckets.set(key, b);
  }
  const out: WeekPoint[] = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const weekStart = addDays(currentWeek, -7 * i);
    const b = buckets.get(weekStart);
    out.push({
      weekStart,
      tonnage: b ? Math.round(b.tonnage * 100) / 100 : 0,
      sets: b ? b.sets : 0,
      workouts: b ? b.days.size : 0,
      current: weekStart === currentWeek,
    });
  }
  return out;
}

/* ------------------------------------------------------ calendar heatmap */

/** Intensity step of one day: 0 = rest, 4 = a full session and then some. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Sets → intensity step. The bands are set around a real session: the built-in
 * program is 16–18 sets, so a whole workout lands on 4 and the lighter steps
 * describe partial days rather than compressing every training day into one
 * indistinguishable block.
 */
export function heatLevel(sets: number): HeatLevel {
  if (sets >= 16) return 4;
  if (sets >= 11) return 3;
  if (sets >= 6) return 2;
  if (sets >= 1) return 1;
  return 0;
}

export interface HeatDay {
  date: string;
  sets: number;
  tonnage: number;
  level: HeatLevel;
  /** True for a date after `today` — the tail of the current week. */
  future: boolean;
}

/** ONE column of the heatmap: a Sun–Sat week, `days[0]` = Sunday. */
export interface HeatWeek {
  weekStart: string;
  days: HeatDay[];
}

/**
 * The last `weeks` Sun–Sat weeks, OLDEST FIRST, every day present.
 *
 * The renderer is the one that decides which end is the left edge (in RTL it
 * reverses this list, see ui/stats.ts); the data stays in chronological order
 * so the bucketing is testable without any layout in the way.
 */
export function heatmap(
  sets: readonly SetStat[],
  today: string,
  weeks: number = HEATMAP_WEEKS,
): HeatWeek[] {
  const span = Math.max(1, Math.floor(weeks));
  const byDate = new Map<string, { sets: number; tonnage: number }>();
  for (const s of sets) {
    const d = byDate.get(s.date) ?? { sets: 0, tonnage: 0 };
    d.sets += 1;
    d.tonnage += s.tonnage;
    byDate.set(s.date, d);
  }
  const firstWeek = addDays(weekStartISO(today), -7 * (span - 1));
  const out: HeatWeek[] = [];
  for (let w = 0; w < span; w += 1) {
    const weekStart = addDays(firstWeek, 7 * w);
    const days: HeatDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = addDays(weekStart, d);
      const hit = byDate.get(date);
      days.push({
        date,
        sets: hit ? hit.sets : 0,
        tonnage: hit ? Math.round(hit.tonnage * 100) / 100 : 0,
        level: heatLevel(hit ? hit.sets : 0),
        future: date > today,
      });
    }
    out.push({ weekStart, days });
  }
  return out;
}

/* ---------------------------------------------------- body-part balance */

export interface PartLoad {
  part: BodyPart;
  /** Volume points (see `SetStat.volume`) attributed to this part. */
  volume: number;
  /** Kilograms attributed to this part — 0 for a purely bodyweight part. */
  tonnage: number;
  sets: number;
  /** `volume / maxVolume`, 0…1 — the bar width. */
  ratio: number;
}

export interface PartBalance {
  parts: PartLoad[];
  /** Most / least trained part by volume, `null` while nothing is logged. */
  most: BodyPart | null;
  least: BodyPart | null;
  total: number;
}

/**
 * Load per body part, attributed through `bodyPartWeights` — the SAME split the
 * XP engine pays by, so the bars agree with the six levels on the דמות screen.
 *
 * The bars are measured in VOLUME points rather than in kilograms on purpose:
 * ליבה is trained almost entirely with bodyweight and planks, so a kilogram
 * scale would draw it as a permanent zero and the chart would say something
 * false about the user's training. Every row still prints its own kilograms
 * beside the bar, which is where tonnage is honest.
 *
 * A set whose exercise no longer resolves is counted in the totals but cannot
 * be attributed to a part — there is nothing left that knows which part it was.
 */
export function partBalance(sets: readonly SetStat[]): PartBalance {
  const volume: Record<BodyPart, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
  const tonnage: Record<BodyPart, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
  const count: Record<BodyPart, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };

  for (const s of sets) {
    if (!s.ex) continue;
    const weights = bodyPartWeights(s.ex);
    for (const part of BODY_PARTS) {
      const w = weights[part];
      if (w <= 0) continue;
      volume[part] += s.volume * w;
      tonnage[part] += s.tonnage * w;
      count[part] += w;
    }
  }

  let max = 0;
  for (const part of BODY_PARTS) max = Math.max(max, volume[part]);

  const parts: PartLoad[] = BODY_PARTS.map((part) => ({
    part,
    volume: Math.round(volume[part] * 10) / 10,
    tonnage: Math.round(tonnage[part] * 10) / 10,
    sets: Math.round(count[part] * 10) / 10,
    ratio: max > 0 ? volume[part] / max : 0,
  }));

  let most: BodyPart | null = null;
  let least: BodyPart | null = null;
  if (max > 0) {
    let hi = -1;
    let lo = Number.POSITIVE_INFINITY;
    for (const p of parts) {
      if (p.volume > hi) {
        hi = p.volume;
        most = p.part;
      }
      if (p.volume < lo) {
        lo = p.volume;
        least = p.part;
      }
    }
  }

  return {
    parts,
    most,
    least,
    total: Math.round(BODY_PARTS.reduce((acc, p) => acc + volume[p], 0) * 10) / 10,
  };
}

/* --------------------------------------------------- per-exercise bests */

/** The best (or first) single set of an exercise. */
export interface BestSet {
  date: string;
  weight: number;
  reps: number;
  volume: number;
}

export interface ExerciseBest {
  exId: string;
  he: string;
  timed: boolean;
  sets: number;
  /** Distinct dates the exercise was trained on — "loyalty". */
  sessions: number;
  totalVolume: number;
  totalTonnage: number;
  /** Heaviest single set ever, by volume (ties → the earlier one). */
  best: BestSet;
  /** The very first completed set ever logged for it. */
  first: BestSet;
  /**
   * Growth from that first set to the best one, in percent — `null` when there
   * is nothing to compare (one set ever, or a first set of volume 0), because a
   * "+0%" for a brand-new exercise reads as stagnation rather than as "new".
   */
  growthPct: number | null;
}

/** Top exercises by total volume, biggest first. */
export function exerciseBests(sets: readonly SetStat[], limit = 8): ExerciseBest[] {
  const byEx = new Map<string, ExerciseBest>();
  for (const s of sets) {
    const entry: BestSet = { date: s.date, weight: s.weight, reps: s.reps, volume: s.volume };
    const found = byEx.get(s.exId);
    if (!found) {
      byEx.set(s.exId, {
        exId: s.exId,
        he: s.he,
        timed: s.timed,
        sets: 1,
        sessions: 1,
        totalVolume: s.volume,
        totalTonnage: s.tonnage,
        best: entry,
        first: entry,
        growthPct: null,
      });
      continue;
    }
    found.sets += 1;
    found.totalVolume += s.volume;
    found.totalTonnage += s.tonnage;
    if (s.volume > found.best.volume) found.best = entry;
  }

  // `sessions` needs distinct dates, which the single pass above cannot count
  // without a second map per exercise — so it is done here, once.
  const dates = new Map<string, Set<string>>();
  for (const s of sets) {
    const set = dates.get(s.exId) ?? new Set<string>();
    set.add(s.date);
    dates.set(s.exId, set);
  }

  const out = [...byEx.values()].map((e) => ({
    ...e,
    sessions: dates.get(e.exId)?.size ?? 1,
    totalVolume: Math.round(e.totalVolume * 10) / 10,
    totalTonnage: Math.round(e.totalTonnage * 10) / 10,
    growthPct:
      e.sets > 1 && e.first.volume > 0
        ? Math.round(((e.best.volume - e.first.volume) / e.first.volume) * 100)
        : null,
  }));

  out.sort((a, b) => b.totalVolume - a.totalVolume || a.he.localeCompare(b.he));
  return out.slice(0, Math.max(0, limit));
}

/* -------------------------------------------------------- the event side */

/**
 * The events a stats number may be computed from: purge-aware (`liveEvents`)
 * and dev-free. See the header of this file for why both filters are needed.
 */
export function trainingEvents(events: readonly AppEvent[]): AppEvent[] {
  return liveEvents(events).filter(
    (ev) => ev.payload['dev'] !== true && ev.type !== 'coins_granted' && ev.type !== 'dev_reset',
  );
}

export interface GameStats {
  wavesCleared: number;
  miniBosses: number;
  worldBosses: number;
  dailyAttempts: number;
  dailyCompleted: number;
  dailyBestScore: number;
  duels: number;
  duelWins: number;
  duelLosses: number;
  /** Coins EARNED in the arena, lifetime (never dev grants, never spending). */
  coinsEarned: number;
  coinsSpent: number;
  /** ⚡ generated by real training, lifetime. */
  energyEarned: number;
  /** Lifetime XP from real (training, retro included) grants. */
  totalXp: number;
  /** Personal records, deduped by (date, exercise, set) like the game's ledger. */
  prs: number;
  /** Current and best streak tier, from `streak_changed`. */
  streakTier: number;
  bestStreakTier: number;
  /** The cute one: `energyEarned / ENERGY_PER_PHONE_CHARGE`, one decimal. */
  phoneCharges: number;
}

/**
 * Fold the game-side lifetime numbers out of the log.
 *
 * The per-day ledgers (daily challenge, duels) are deduped by exactly the key
 * the game state uses — date, and (date, opponent) — so a merged log that holds
 * two events for the same challenge counts one attempt here too.
 */
export function gameStats(events: readonly AppEvent[]): GameStats {
  const ordered = trainingEvents(events);
  const bosses = new Set<string>();
  const dailies = new Map<string, { complete: boolean; score: number }>();
  const duels = new Map<string, boolean>();
  const prKeys = new Set<string>();

  let wavesCleared = 0;
  let miniBosses = 0;
  let coinsEarned = 0;
  let coinsSpent = 0;
  let energyEarned = 0;
  let totalXp = 0;
  let streakTier = 0;
  let bestStreakTier = 0;

  for (const ev of ordered) {
    const p = ev.payload;
    switch (ev.type) {
      case 'wave_cleared':
        wavesCleared += 1;
        if (p['miniBoss'] === true) miniBosses += 1;
        coinsEarned += num(p['coins']);
        break;
      case 'boss_defeated':
        bosses.add(str(p['bossId']));
        coinsEarned += num(p['coins']);
        break;
      case 'daily_challenge': {
        const date = str(p['date']);
        if (dailies.has(date)) break;
        dailies.set(date, { complete: p['complete'] === true, score: num(p['score'] ?? p['wavesCleared']) });
        coinsEarned += num(p['coins']);
        break;
      }
      case 'ghost_duel': {
        const key = `${str(p['date'])}|${str(p['opponentHandle'])}`;
        if (duels.has(key)) break;
        duels.set(key, p['won'] === true);
        coinsEarned += num(p['coins']);
        break;
      }
      case 'coins_spent':
      case 'item_upgraded':
      case 'character_purchased':
        coinsSpent += num(p['cost']);
        break;
      case 'energy_gained':
        energyEarned += num(p['amount']);
        break;
      case 'xp_gained':
        totalXp += num(p['total']);
        break;
      case 'pr_achieved':
        prKeys.add(`${str(p['date'])}|${str(p['exId'])}|${num(p['setIndex'])}`);
        break;
      case 'streak_changed':
        streakTier = num(p['to']);
        bestStreakTier = Math.max(bestStreakTier, streakTier);
        break;
      // A wipe is the one event that resets the lifetime story: everything
      // before it is gone from the app, so it must be gone from the totals too.
      case 'data_cleared':
        bosses.clear();
        dailies.clear();
        duels.clear();
        prKeys.clear();
        wavesCleared = 0;
        miniBosses = 0;
        coinsEarned = 0;
        coinsSpent = 0;
        energyEarned = 0;
        totalXp = 0;
        streakTier = 0;
        bestStreakTier = 0;
        break;
      default:
        break;
    }
  }

  let dailyCompleted = 0;
  let dailyBestScore = 0;
  for (const run of dailies.values()) {
    if (run.complete) dailyCompleted += 1;
    dailyBestScore = Math.max(dailyBestScore, run.score);
  }
  let duelWins = 0;
  for (const won of duels.values()) if (won) duelWins += 1;

  return {
    wavesCleared,
    miniBosses,
    worldBosses: bosses.size,
    dailyAttempts: dailies.size,
    dailyCompleted,
    dailyBestScore,
    duels: duels.size,
    duelWins,
    duelLosses: duels.size - duelWins,
    coinsEarned: Math.round(coinsEarned),
    coinsSpent: Math.round(coinsSpent),
    energyEarned: Math.round(energyEarned),
    totalXp: Math.round(totalXp * 100) / 100,
    prs: prKeys.size,
    streakTier,
    bestStreakTier,
    phoneCharges: round1(energyEarned / ENERGY_PER_PHONE_CHARGE),
  };
}

/* ------------------------------------------------------------- oddballs */

export interface Oddballs {
  /** Estimated seconds spent resting: Σ completed sets × their own rest. */
  restSeconds: number;
  /** The single heaviest set ever (by kilograms on the bar). */
  heaviestSet: SetStat | null;
  /** XP earned per TON lifted, or `null` before a single kilogram moved. */
  xpPerTon: number | null;
  /** The exercise trained on the most distinct days. */
  loyal: { exId: string; he: string; sessions: number } | null;
  /** The longest stretch between two consecutive workouts, in days. */
  longestGap: { days: number; from: string; to: string } | null;
}

export function oddballs(sets: readonly SetStat[], totalXp: number, tonnage: number): Oddballs {
  let restSeconds = 0;
  let heaviest: SetStat | null = null;
  const dates = new Set<string>();
  const byEx = new Map<string, { he: string; days: Set<string> }>();

  for (const s of sets) {
    restSeconds += s.rest;
    dates.add(s.date);
    // "Heaviest" is about the BAR, so it is ordered by kilograms first and only
    // then by reps — 100kg×1 beats 40kg×12, which is what a lifter means.
    if (s.weight > 0 && (!heaviest || s.weight > heaviest.weight || (s.weight === heaviest.weight && s.reps > heaviest.reps))) {
      heaviest = s;
    }
    const e = byEx.get(s.exId) ?? { he: s.he, days: new Set<string>() };
    e.days.add(s.date);
    byEx.set(s.exId, e);
  }

  let loyal: Oddballs['loyal'] = null;
  for (const [exId, e] of byEx) {
    if (!loyal || e.days.size > loyal.sessions) loyal = { exId, he: e.he, sessions: e.days.size };
  }

  let longestGap: Oddballs['longestGap'] = null;
  const ordered = [...dates].sort();
  for (let i = 1; i < ordered.length; i += 1) {
    const from = ordered[i - 1];
    const to = ordered[i];
    if (from === undefined || to === undefined) continue;
    const days = daysBetween(from, to);
    if (!longestGap || days > longestGap.days) longestGap = { days, from, to };
  }

  return {
    restSeconds,
    heaviestSet: heaviest,
    xpPerTon: tonnage > 0 ? round1(totalXp / (tonnage / 1000)) : null,
    loyal,
    longestGap,
  };
}

/* --------------------------------------------------------------- the whole */

export interface StatsInput {
  sessions: Readonly<Record<string, Session>>;
  events: readonly AppEvent[];
  /** Plan-aware exercise lookup (`core/plan.ts#makeResolver`). */
  resolve: ExerciseResolver;
  /** ISO date of "today" — ALWAYS passed in; this module never asks the clock. */
  today: string;
}

export interface Stats {
  today: string;
  /** True while not one set has ever been completed — the empty state. */
  empty: boolean;
  basics: Basics;
  equivalents: EquivalentsResult;
  weekly: WeekPoint[];
  heatmap: HeatWeek[];
  balance: PartBalance;
  bests: ExerciseBest[];
  game: GameStats;
  odd: Oddballs;
}

/** Everything the 📊 screen shows, from the two sources and nothing else. */
export function computeStats(input: StatsInput): Stats {
  const sets = completedSets(input.sessions, input.resolve);
  const base = basics(sets, input.today);
  const game = gameStats(input.events);
  return {
    today: input.today,
    empty: sets.length === 0,
    basics: base,
    equivalents: equivalentsOf(base.tonnage),
    weekly: weeklyTonnage(sets, input.today),
    heatmap: heatmap(sets, input.today),
    balance: partBalance(sets),
    bests: exerciseBests(sets),
    game,
    odd: oddballs(sets, game.totalXp, base.tonnage),
  };
}
