/**
 * core/planLibrary.ts — turning a library template into a user's plan.
 *
 * A template (`data/planLibrary.ts`) is authored for an intermediate trainee
 * who wants to build muscle. The questionnaire knows more than that, and this
 * module applies it when the plan is BUILT — never later, never to history:
 *
 *   1. injuries      — flagged exercises are swapped for safer ones that the
 *                      location's equipment allows (`INJURY_SWAPS`);
 *   2. goal          — strength: the day's first two compounds go heavy
 *                      (4–6 reps, 150 s, +1 set); lose fat / recomp: shorter
 *                      isolation rests and a conditioning finisher; general /
 *                      other: one set less on isolations; build muscle: as is;
 *   3. experience    — beginner: ≤3 sets a row, ≤5 exercises a day;
 *                      advanced: +1 set on the day's first compound;
 *   4. session length — 30 min → 4 exercises … 90 min → 8 (the finisher counts).
 *
 * Trimming always drops TRAILING ISOLATIONS first and never the finisher.
 *
 * Every step is a pure function over rows, exported and unit-tested on its own;
 * `buildLibraryPlan` composes them and is the only place that mints day keys
 * (through `newDayKey`, like every preset) and reads the locale (the day labels
 * are built in the language on screen, then belong to the user).
 */

import { PLAN_DOC_VERSION, type PlanDoc, type PlanExercise } from '../data/planTypes.ts';
import {
  COMPOUND_IDS,
  HARD_BODYWEIGHT_IDS,
  LIBRARY_WEEKDAYS,
  equipAllowed,
  templateById,
  type PlanTemplate,
} from '../data/planLibrary.ts';
import { findExercise } from '../data/program.ts';
import { locale } from '../i18n/locale.ts';
import { PLAN_LIMITS, deriveWeeklyTarget, makePlanDay, newDayKey } from './plan.ts';
import { onWeekdays, type Experience, type Goal, type Injury, type Location, type Profile } from './profile.ts';

/** What a profile contributes to a library plan. Every field is optional. */
export interface LibraryBuildOptions {
  goal?: Goal;
  experience?: Experience;
  sessionMinutes?: number;
  injuries?: readonly Injury[];
  /** The user's weekdays (0 = Sunday); the plan's days are re-laid onto them. */
  weekdays?: readonly number[];
}

/** A row while it is being built: a plan row, plus "this is the finisher". */
export interface LibraryRowDraft extends PlanExercise {
  finisher?: true;
}

/** The options a profile implies (nothing else of the profile is read). */
export function planOptionsOf(profile: Profile | null | undefined): LibraryBuildOptions {
  if (!profile) return {};
  const o: LibraryBuildOptions = {};
  if (profile.goal) o.goal = profile.goal;
  if (profile.experience) o.experience = profile.experience;
  if (profile.sessionMinutes !== undefined) o.sessionMinutes = profile.sessionMinutes;
  if (profile.injuries && profile.injuries.length > 0) o.injuries = [...profile.injuries];
  if (profile.weekdays && profile.weekdays.length > 0) o.weekdays = [...profile.weekdays];
  return o;
}

/* ---------------------------------------------------------- row helpers */

export function isCompound(id: string): boolean {
  return COMPOUND_IDS.has(id);
}

const row = (id: string, sets: number, reps: string, rest: number): LibraryRowDraft => ({ id, sets, reps, rest });

const capSets = (n: number): number => Math.min(PLAN_LIMITS.maxSets, n);

/** The rep scheme with its number range replaced, keeping any "לרגל" / "לצד" suffix. */
export function withReps(reps: string, range: string): string {
  const m = /^\s*\d+(?:\s*[–-]\s*\d+)?/.exec(reps);
  return m ? range + reps.slice(m[0].length) : range;
}

/**
 * Drop rows until at most `cap` remain: the LAST isolation first, then (only
 * when no isolation is left) the last compound. The finisher is never dropped.
 */
export function trimRows(rows: readonly LibraryRowDraft[], cap: number): LibraryRowDraft[] {
  const out = [...rows];
  while (out.length > cap) {
    let idx = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      const r = out[i];
      if (r && !r.finisher && !isCompound(r.id)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (!out[i]?.finisher) {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) break;
    out.splice(idx, 1);
  }
  return out;
}

/* ------------------------------------------------------------- injuries */

/** What each injury flags — never programmed for that user. */
export const INJURY_AVOID: Readonly<Record<Injury, readonly string[]>> = {
  // Heavy loaded spinal flexion / unsupported hinge-and-row.
  back: ['g2', 'g4', 'b4'],
  // Jumps and deep lunges.
  knees: ['w9', 'w10', 'w2', 'a3', 'h3', 'x28'],
  // Overhead pressing, dips and pike push-ups.
  shoulders: ['g5', 'c3', 'h2', 'b3', 'w5', 'w7'],
};

type SwapTable = Readonly<Record<string, readonly string[]>>;

/**
 * The substitutions, per location: for each flagged exercise, the candidates
 * in order of preference. The first one that is not already in the day and not
 * flagged by another of the user's injuries wins; when none is left the row is
 * dropped. Every candidate obeys the location's equipment rule (tested).
 */
export const INJURY_SWAPS: Readonly<Record<Location, SwapTable>> = {
  gym: {
    // back
    g2: ['g6', 'g7', 'x3'], // deadlift → hip thrust / leg press / leg curl
    g4: ['x18', 'x15', 'x20'], // bent-over row → chest-supported / cable rows
    b4: ['x18', 'x15', 'x20'],
    // knees
    a3: ['g6', 'h4', 'x29', 'g12', 'g11', 'x3'], // lunges → hip thrust / step-up / single-leg hinge
    h3: ['g6', 'h4', 'x29', 'g12', 'g11', 'x3'],
    x28: ['g6', 'h4', 'x29', 'g12', 'g11', 'x3'],
    w2: ['g6', 'h4', 'x29', 'g12', 'g11', 'x3'],
    w9: ['w8', 'g6'],
    w10: ['w8'],
    // shoulders
    g5: ['g8', 'x4', 'x7', 'h7'], // overhead press → lateral raises / face pull / rear delts
    c3: ['g8', 'x4', 'x7', 'h7'],
    h2: ['g8', 'x4', 'x7', 'h7'],
    w5: ['g8', 'x4', 'x7'],
    b3: ['x12', 'x5', 'h8'], // dips → flat DB press / pushdown
    w7: ['x5', 'h8', 'x31'],
  },
  home_dumbbells: {
    g2: ['h5', 'w3', 'x11'],
    g4: ['a2', 'h11', 'w6'],
    b4: ['a2', 'h11', 'w6'], // bent-over row → supported one-arm row / band row
    a3: ['h5', 'h4', 'x29', 'w3', 'h12', 'h9'],
    h3: ['h5', 'h4', 'x29', 'w3', 'h12', 'h9'],
    x28: ['h5', 'h4', 'x29', 'w3', 'h12', 'h9'],
    w2: ['h5', 'h4', 'x29', 'w3', 'h12', 'h9'],
    w9: ['w8', 'w3'],
    w10: ['w8'],
    g5: ['x4', 'h7', 'h10'],
    c3: ['x4', 'h7', 'h10'],
    h2: ['x4', 'h7', 'h10'],
    w5: ['x4', 'h10', 'h7'],
    b3: ['h1', 'h8'],
    w7: ['h8', 'x31'],
  },
  home_none: {
    g2: ['w3', 'w13'],
    g4: ['w6', 'x27'],
    b4: ['w6', 'x27'],
    a3: ['w3', 'w13', 'x29', 'w14', 'w12', 'w11'], // lunges → bridge / step-up / single-leg hinge
    h3: ['w3', 'w13', 'x29', 'w14', 'w12', 'w11'],
    x28: ['w3', 'w13', 'x29', 'w14', 'w12', 'w11'],
    w2: ['w3', 'w13', 'x29', 'w14', 'w12', 'w11'],
    w9: ['w8', 'w3'],
    w10: ['w8'],
    g5: ['w4', 'x30', 'x27'],
    c3: ['w4', 'x30', 'x27'],
    h2: ['w4', 'x30', 'x27'],
    w5: ['w4', 'x30', 'x27'], // pike push-up → incline push-up
    b3: ['x31', 'w4', 'x30'],
    w7: ['x31', 'w4', 'x30'], // bench dips → diamond push-up
  },
};

/** Every exercise id the user's injuries flag. */
export function flaggedBy(injuries: readonly Injury[] | undefined): Set<string> {
  return new Set((injuries ?? []).flatMap((i) => INJURY_AVOID[i] ?? []));
}

/**
 * Swap every flagged row of a day for the first acceptable candidate. The new
 * row keeps the old one's set count and takes its reps / rest from the
 * exercise's own coaching defaults (a lateral raise does not inherit a press's
 * 6–8). A row with no acceptable candidate is dropped.
 */
export function applyInjuries(
  rows: readonly LibraryRowDraft[],
  location: Location,
  injuries: readonly Injury[] | undefined,
): LibraryRowDraft[] {
  const flagged = flaggedBy(injuries);
  if (flagged.size === 0) return [...rows];
  const table = INJURY_SWAPS[location];
  const taken = new Set(rows.map((r) => r.id));
  const out: LibraryRowDraft[] = [];
  for (const r of rows) {
    if (!flagged.has(r.id)) {
      out.push(r);
      continue;
    }
    const pick = (table[r.id] ?? []).find((c) => !taken.has(c) && !flagged.has(c) && findExercise(c) !== null);
    const def = pick ? findExercise(pick) : null;
    if (!pick || !def) continue;
    taken.add(pick);
    out.push(row(pick, r.sets, def.reps, def.rest));
  }
  return out;
}

/* ----------------------------------------------------------------- goal */

/** Can this exercise be made heavier by asking for fewer reps? */
function loadable(id: string): boolean {
  if (HARD_BODYWEIGHT_IDS.has(id)) return true;
  const def = findExercise(id);
  return !!def && def.equip.some((e) => e !== 'Bodyweight');
}

/** The conditioning finisher of a lose-fat / recomp day, or `null`. */
export function finisherFor(
  location: Location,
  dayIndex: number,
  taken: ReadonlySet<string>,
  flagged: ReadonlySet<string>,
): LibraryRowDraft | null {
  if (location === 'gym') {
    // The treadmill incline walk is a CARDIO exercise: sets are 5-minute
    // stages and `rest` is the stage length in seconds (it drives the timer).
    return taken.has('x21') ? null : { ...row('x21', 3, '5 דק׳', 300), finisher: true };
  }
  const order = dayIndex % 2 === 0 ? ['w10', 'w8'] : ['w8', 'w10'];
  const id = order.find((c) => !taken.has(c) && !flagged.has(c));
  return id ? { ...row(id, 3, '30–45 שנ׳', 30), finisher: true } : null;
}

export interface GoalContext {
  location: Location;
  /** Position of the day in the week — alternates the home finisher. */
  dayIndex: number;
  injuries?: readonly Injury[] | undefined;
}

export function applyGoal(rows: readonly LibraryRowDraft[], goal: Goal | undefined, ctx: GoalContext): LibraryRowDraft[] {
  switch (goal) {
    case 'strength': {
      let heavy = 0;
      return rows.map((r) => {
        if (r.finisher || !isCompound(r.id) || heavy >= 2) return r;
        heavy++;
        // A push-up or an air squat does not get heavier by doing fewer: it
        // keeps its reps and earns the extra set only.
        return loadable(r.id)
          ? { ...r, sets: capSets(r.sets + 1), reps: withReps(r.reps, '4–6'), rest: 150 }
          : { ...r, sets: capSets(r.sets + 1) };
      });
    }
    case 'lose_fat':
    case 'recomp': {
      const out = rows.map((r) =>
        r.finisher || isCompound(r.id) || r.rest <= 45 ? r : { ...r, rest: Math.max(45, r.rest - 15) },
      );
      const fin = finisherFor(ctx.location, ctx.dayIndex, new Set(out.map((r) => r.id)), flaggedBy(ctx.injuries));
      return fin ? [...out, fin] : out;
    }
    case 'general':
    case 'other':
      return rows.map((r) => (r.finisher || isCompound(r.id) || r.sets <= 2 ? r : { ...r, sets: r.sets - 1 }));
    case 'build_muscle':
    case undefined:
      return [...rows];
  }
}

/* ----------------------------------------------------------- experience */

export const BEGINNER_MAX_SETS = 3;
export const BEGINNER_MAX_EXERCISES = 5;

export function applyExperience(rows: readonly LibraryRowDraft[], experience: Experience | undefined): LibraryRowDraft[] {
  if (experience === 'beginner') {
    const capped = rows.map((r) => (r.sets > BEGINNER_MAX_SETS ? { ...r, sets: BEGINNER_MAX_SETS } : r));
    return trimRows(capped, BEGINNER_MAX_EXERCISES);
  }
  if (experience === 'advanced') {
    const first = rows.findIndex((r) => !r.finisher && isCompound(r.id));
    return rows.map((r, i) => (i === first ? { ...r, sets: capSets(r.sets + 1) } : r));
  }
  return [...rows];
}

/* ------------------------------------------------------- session length */

/** How many exercises fit a session: 30 min → 4, 45 → 5, 60 → 6, 75 → 7, 90 → 8. */
export function maxExercisesFor(minutes: number | undefined): number {
  if (minutes === undefined) return Number.POSITIVE_INFINITY;
  if (minutes <= 30) return 4;
  if (minutes <= 45) return 5;
  if (minutes <= 60) return 6;
  if (minutes <= 75) return 7;
  return 8;
}

export function applySessionLength(rows: readonly LibraryRowDraft[], minutes: number | undefined): LibraryRowDraft[] {
  return trimRows(rows, maxExercisesFor(minutes));
}

/* ------------------------------------------------------------- building */

/** The rows of every day of `template` under `opts` — pure, no ids minted. */
export function libraryRows(template: PlanTemplate, opts: LibraryBuildOptions = {}): LibraryRowDraft[][] {
  return template.week.map((d, dayIndex) => {
    let rows: LibraryRowDraft[] = d.rows.map(([id, sets, reps, rest]) => row(id, sets, reps, rest));
    rows = applyInjuries(rows, template.location, opts.injuries);
    rows = applyGoal(rows, opts.goal, { location: template.location, dayIndex, injuries: opts.injuries });
    rows = applyExperience(rows, opts.experience);
    rows = applySessionLength(rows, opts.sessionMinutes);
    return rows;
  });
}

/** Does every row of `rows` obey the location's equipment rule? */
export function rowsFitLocation(rows: readonly PlanExercise[], location: Location): boolean {
  return rows.every((r) => {
    const def = findExercise(r.id);
    return !!def && equipAllowed(location, def.equip);
  });
}

/**
 * A complete, fresh `PlanDoc` from a library template: day keys minted per
 * build, day labels in the language on screen, the template's own weekdays —
 * or the user's, when `opts.weekdays` is given.
 */
export function buildLibraryPlan(templateId: string, opts: LibraryBuildOptions = {}): PlanDoc {
  const template = templateById(templateId);
  if (!template) throw new Error(`unknown plan template ${templateId}`);
  const en = locale() === 'en';
  const wd = LIBRARY_WEEKDAYS[template.days];
  const rows = libraryRows(template, opts);
  const days = template.week.map((d, i) =>
    makePlanDay(
      newDayKey(),
      en ? d.en : d.he,
      wd[i] === undefined ? [] : [wd[i]],
      (rows[i] ?? []).map((r) => ({ id: r.id, sets: r.sets, reps: r.reps, rest: r.rest })),
    ),
  );
  const doc: PlanDoc = {
    version: PLAN_DOC_VERSION,
    rev: 0,
    days,
    weeklyTarget: deriveWeeklyTarget(days),
    customExercises: [],
  };
  return opts.weekdays && opts.weekdays.length > 0 ? onWeekdays(doc, opts.weekdays) : doc;
}
