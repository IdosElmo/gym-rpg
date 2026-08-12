/**
 * core/xp.ts — XP formulas, body-part levels, streaks and the game reducer.
 *
 * Everything here is PURE: no DOM, no storage, no `Date.now()`. The current
 * date is always passed in, so live state and replayed state are byte-identical.
 *
 * DESIGN — event sourcing
 * ----------------------
 * `GameState` is a CACHE. The append-only log is the source of truth:
 *   grant builders (`buildSetGrant`, `buildWorkoutCompletionGrant`) look at the
 *   current game state and RETURN the events to append; `applyGameEvent` folds
 *   an event into the state. The live app and `rebuildGame()` run the exact same
 *   reducer over the exact same events, which is what makes replay provably
 *   equivalent (see tests/xp.test.ts + tests/game.test.ts).
 *
 * DESIGN — no XP farming
 * ----------------------
 * XP/energy are granted ONCE per (date, exercise, set index), recorded in
 * `game.granted`. Unchecking a set does NOT refund XP, and re-checking it grants
 * nothing new — so the check button can never be used as an XP faucet. Same idea
 * for the workout-completion bonus, guarded once per date via `game.bonusDays`.
 *
 * DESIGN — retroactive history
 * ----------------------------
 * Sessions that predate the game layer (legacy import, JSON import, or workouts
 * logged under Phase 0) are granted XP with `retro: true`. Retro grants pay XP
 * and PRs, but deliberately NOT battle energy and NOT streak days — the streak
 * starts at 0 for imported history, per the brief.
 */

import {
  BODY_PARTS,
  BUILTIN_PROGRAM,
  DEFAULT_WEEKLY_TARGET,
  bodyPartWeights,
  dayOf,
  findExercise,
  type BodyPart,
  type DayKey,
  type Exercise,
  type ExerciseResolver,
  type ResolvedProgram,
} from '../data/program.ts';
import { weeklyTargetOfPlanPayload } from '../data/planTypes.ts';
import { BALANCE } from './balance.ts';
import { bestDailyStreak, dailyStreak } from './daily.ts';
import { duelKey, normalizeHandle } from './handle.ts';
import type { ChallengeResult } from './combat.ts';
import {
  EQUIPMENT_SLOTS,
  equipmentById,
  sumEquipBonus,
  zeroBonus,
  type EquipmentSlot,
  type ResolvedBonus,
} from '../data/gameContent.ts';
import {
  MAX_UPGRADE_LEVEL,
  clampUpgradeLevel,
  upgradeLevelOf,
  upgradeMultiplier,
  upgradeStepCost,
} from './upgrades.ts';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  SKINS,
  characterById,
  characterId,
  defaultCharacter,
  isBaseSkin,
  resolveCharacterId,
  skinOf,
  type BodyGeometry,
  type CharacterDef,
  type SkinDef,
} from '../data/characters.ts';
import {
  GAME_STATE_VERSION,
  type AppEvent,
  type BattleProgress,
  type CharactersState,
  type DailyChallengePayload,
  type DailyChallengeState,
  type DailyRunRecord,
  type EquipmentState,
  type EventType,
  type GameState,
  type GhostDuelPayload,
  type GhostDuelRecord,
  type GhostDuelState,
  type PartsProgress,
  type Session,
  type SetEntry,
  type StreakState,
} from '../storage/DataStore.ts';

/* ------------------------------------------------------------- primitives */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Round to 2 decimals — keeps the event log tidy and float noise out of tests. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Parse a logged string field ("42.5", "", "abc") into a non-negative number. */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------ level curve */

/** XP needed to go FROM level `n` to level `n+1` — `100 × 1.35^(n−1)`. */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return BALANCE.xp.levelBase * Math.pow(BALANCE.xp.levelGrowth, n - 1);
}

/** Cumulative XP needed to REACH level `n` (level 1 costs nothing). */
export function totalXpToReach(level: number): number {
  const n = Math.max(1, Math.floor(level));
  const g = BALANCE.xp.levelGrowth;
  return (BALANCE.xp.levelBase * (Math.pow(g, n - 1) - 1)) / (g - 1);
}

/** Level for a total XP pool. Levels start at 1 and are capped by balance. */
export function levelForXp(totalXp: number): number {
  let remaining = Math.max(0, totalXp);
  let level = 1;
  while (level < BALANCE.xp.maxLevel) {
    const need = xpForLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP accumulated inside the current level. */
  into: number;
  /** XP the current level needs in total. */
  need: number;
  /** `into / need`, clamped to 0..1 — the progress-bar width. */
  ratio: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelForXp(totalXp);
  const into = Math.max(0, totalXp - totalXpToReach(level));
  const need = xpForLevel(level);
  return { level, into: round2(into), need: round2(need), ratio: clamp(need > 0 ? into / need : 1, 0, 1) };
}

/** Headline character level = floor(average of the six body-part levels). */
export function characterLevel(parts: PartsProgress): number {
  let sum = 0;
  for (const part of BODY_PARTS) sum += parts[part].level;
  return Math.max(1, Math.floor(sum / BODY_PARTS.length));
}

/* ---------------------------------------------------------------- volume */

/**
 * Volume of one logged set.
 * - weighted sets: `weight × reps`
 * - bodyweight / timed sets (no weight): the reps or seconds value alone
 * - a weight with no reps: the weight alone (partial log, better than 0)
 */
export function setVolume(w: string, r: string): number {
  const weight = toNumber(w);
  const reps = toNumber(r);
  if (weight > 0 && reps > 0) return round2(weight * reps);
  if (reps > 0) return reps;
  if (weight > 0) return weight;
  return 0;
}

/** `clamp(volume / previousBest, 0.5, 1.5)`; 1 when there is nothing to compare. */
export function volumeFactor(volume: number, previousBest: number): number {
  if (!(volume > 0) || !(previousBest > 0)) return 1;
  return clamp(volume / previousBest, BALANCE.xp.volumeFactorMin, BALANCE.xp.volumeFactorMax);
}

/**
 * A PR needs a previous best to beat: the very first set of an exercise
 * ESTABLISHES the baseline rather than being celebrated as a record.
 */
export function isPersonalRecord(volume: number, previousBest: number): boolean {
  return volume > 0 && previousBest > 0 && volume > previousBest;
}

export interface SetXpResult {
  xp: number;
  factor: number;
  pr: boolean;
  volume: number;
}

/** `baseXP × volumeFactor`, doubled on a new personal record. */
export function xpForSet(volume: number, previousBest: number): SetXpResult {
  const factor = volumeFactor(volume, previousBest);
  const pr = isPersonalRecord(volume, previousBest);
  const xp = round2(BALANCE.xp.baseSetXp * factor * (pr ? BALANCE.xp.prMultiplier : 1));
  return { xp, factor: round2(factor), pr, volume };
}

/** Split a set's XP across the exercise's body parts (weights always sum to 1). */
export function splitXp(xp: number, ex: Exercise): Partial<Record<BodyPart, number>> {
  const weights = bodyPartWeights(ex);
  const out: Partial<Record<BodyPart, number>> = {};
  for (const part of BODY_PARTS) {
    const w = weights[part];
    if (w > 0) out[part] = round2(xp * w);
  }
  return out;
}

/** The workout-completion bonus: a flat amount to EVERY body part. */
export function completionSplit(): Partial<Record<BodyPart, number>> {
  const out: Partial<Record<BodyPart, number>> = {};
  for (const part of BODY_PARTS) out[part] = BALANCE.xp.workoutCompletionBonus;
  return out;
}

/* ---------------------------------------------------------------- streaks */

const DAY_MS = 86_400_000;

/** ISO date -> epoch ms at 00:00 UTC (deterministic, DST-free date math). */
export function isoToTs(date: string): number {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isNaN(t) ? 0 : t;
}

export function tsToIso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return tsToIso(isoToTs(date) + days * DAY_MS);
}

/** Sunday that starts the calendar week containing `date` (Sun–Sat weeks). */
export function weekStartISO(date: string): string {
  const ts = isoToTs(date);
  const dow = new Date(ts).getUTCDay(); // 0 = Sunday
  return tsToIso(ts - dow * DAY_MS);
}

/* ------------------------------------------------- the weekly-target history */

/**
 * ONE point of the plan's weekly-target history: from `ts` on, a perfect week
 * means `target` distinct training days.
 */
export interface WeeklyTargetPoint {
  ts: number;
  target: number;
}

/** The plan's weekly targets over time, ascending by `ts`. */
export type WeeklyTargets = readonly WeeklyTargetPoint[];

/**
 * Fold the weekly target out of the event log.
 *
 * The plan is an event like everything else (`plan_updated` carries the whole
 * document, `data_cleared` resets to the built-in program), so the target a
 * given week has to be judged against is a function of the event SET alone —
 * which is exactly what makes the streak survive a union merge: both devices
 * hold the same plan events, so both judge every week identically.
 *
 * Only the target is read here, not the whole document: the XP engine has no
 * business knowing what a plan looks like, and `weeklyTargetOfPlanPayload` (in
 * data/planTypes.ts) applies the same fallbacks `normalizePlanDoc` does.
 */
export function weeklyTargetsFromEvents(events: readonly AppEvent[]): WeeklyTargets {
  const out: WeeklyTargetPoint[] = [];
  for (const ev of [...events].sort(compareEvents)) {
    if (ev.type === 'plan_updated') {
      out.push({ ts: ev.ts, target: weeklyTargetOfPlanPayload(ev.payload['plan']) });
    } else if (ev.type === 'data_cleared') {
      // A wipe puts the built-in program back — plan included.
      out.push({ ts: ev.ts, target: DEFAULT_WEEKLY_TARGET });
    }
  }
  return out;
}

/** The target in force at an instant: the last point at or before it. */
export function weeklyTargetAt(targets: WeeklyTargets, ts: number): number {
  let target = DEFAULT_WEEKLY_TARGET;
  for (const point of targets) {
    if (point.ts > ts) break;
    target = point.target;
  }
  return target;
}

/**
 * The target a CLOSED week is judged by: the plan in force when that week ended.
 *
 * Judging by the end of the week (rather than by its start) means the plan you
 * were actually training under decides — switching to a 4-day plan on Wednesday
 * asks four days of that same week, which is what the app just told the user.
 */
export function weeklyTargetForWeek(targets: WeeklyTargets, weekStart: string): number {
  return weeklyTargetAt(targets, isoToTs(addDays(weekStart, 7)) - 1);
}

/**
 * Streak tier from the distinct LIVE workout days.
 *
 * Every calendar week that has already CLOSED (i.e. every week before the one
 * containing `today`), starting from the week of the first workout, is judged
 * against THE PLAN THAT WAS ACTIVE THAT WEEK: enough distinct workout days →
 * tier +1, otherwise tier −1 (floor 0). The week in progress is never judged.
 * Levels and XP are never touched by a tier drop.
 *
 * With no `targets` (no plan in the log) the threshold is the built-in program's
 * three days a week — i.e. exactly what this function always did.
 */
export function computeStreak(
  days: readonly string[],
  today: string,
  targets: WeeklyTargets = [],
): StreakState {
  const needed = weeklyTargetAt(targets, Number.POSITIVE_INFINITY);
  const currentWeek = weekStartISO(today);
  const unique = [...new Set(days)].sort();
  const first = unique[0];
  if (first === undefined) {
    return { tier: 0, weekStart: currentWeek, daysThisWeek: 0, needed };
  }

  let tier = 0;
  let week = weekStartISO(first);
  // Guard against a corrupt far-past date turning this into an infinite loop.
  for (let guard = 0; week < currentWeek && guard < 5200; guard += 1) {
    const end = addDays(week, 7);
    const count = unique.filter((d) => d >= week && d < end).length;
    tier = count >= weeklyTargetForWeek(targets, week) ? tier + 1 : Math.max(0, tier - 1);
    week = end;
  }

  const weekEnd = addDays(currentWeek, 7);
  const daysThisWeek = unique.filter((d) => d >= currentWeek && d < weekEnd).length;
  return { tier, weekStart: currentWeek, daysThisWeek, needed };
}

/** The permanent stacking buff multiplier: `1 + 0.1 × tier`. */
export function streakMultiplier(tier: number): number {
  return 1 + BALANCE.streak.buffPerTier * Math.max(0, tier);
}

/* ------------------------------------------------------------ game state */

export function emptyParts(): PartsProgress {
  return {
    chest: { xp: 0, level: 1 },
    back: { xp: 0, level: 1 },
    legs: { xp: 0, level: 1 },
    shoulders: { xp: 0, level: 1 },
    arms: { xp: 0, level: 1 },
    core: { xp: 0, level: 1 },
  };
}

export function emptyGame(): GameState {
  return {
    version: GAME_STATE_VERSION,
    parts: emptyParts(),
    level: 1,
    totalXp: 0,
    energy: 0,
    energyEarned: 0,
    prCount: 0,
    best: {},
    granted: {},
    bonusDays: {},
    energyGranted: {},
    prKeys: {},
    workoutDays: [],
    streak: { tier: 0, weekStart: null, daysThisWeek: 0, needed: BALANCE.streak.daysPerWeek },
    battle: emptyBattle(),
    equipment: emptyEquipment(),
    characters: emptyCharacters(),
    daily: emptyDaily(),
    duels: emptyDuels(),
    devUsed: false,
    devKeys: {},
    devCycles: {},
  };
}

/** A fresh duel ledger: nobody fought yet, so every total is zero. */
export function emptyDuels(): GhostDuelState {
  return { runs: {}, duels: 0, wins: 0, losses: 0, byOpponent: {} };
}

/** A fresh daily-challenge ledger: nothing attempted, so everything is zero. */
export function emptyDaily(): DailyChallengeState {
  return {
    runs: {},
    attempts: 0,
    completed: 0,
    bestScore: 0,
    bestTiebreak: 0,
    bestDate: null,
    streak: 0,
    bestStreak: 0,
  };
}

/** A fresh battle progress: world 1, wave 1, no coins, no trophies. */
export function emptyBattle(): BattleProgress {
  return { world: 1, wave: 1, coins: 0, wavesCleared: 0, miniBossesCleared: 0, bossesDefeated: [] };
}

/** A fresh wardrobe: nothing owned, nothing worn, nothing upgraded. */
export function emptyEquipment(): EquipmentState {
  return { owned: [], equipped: {}, upgrades: {} };
}

/**
 * A fresh roster: no skins bought, playing the default hero on the default body.
 * The free skin is not listed because free skins are never listed — `ownsSkin`
 * treats every `cost: 0` skin as owned, on BOTH bodies.
 */
export function emptyCharacters(): CharactersState {
  return { owned: [], selected: DEFAULT_CHARACTER_ID };
}

/**
 * Can this save wear that SKIN? Free skins: always. Bought ones: if bought.
 *
 * There is deliberately no body in this question: a purchase unlocks the skin
 * on both bodies at once, which is the whole point of the matrix.
 */
export function ownsSkin(game: GameState, skinId: string): boolean {
  const skin = skinOf(skinId);
  if (!skin) return false;
  return isBaseSkin(skin.id) || game.characters.owned.includes(skin.id);
}

/** Can this save play that combination? (Its skin has to be owned.) */
export function ownsCharacter(game: GameState, id: string): boolean {
  const def = characterById(resolveCharacterId(id) ?? '');
  return def !== undefined && ownsSkin(game, def.skin);
}

/** The character being played — the default whenever the stored id is unusable. */
export function selectedCharacter(game: GameState): CharacterDef {
  const id = resolveCharacterId(game.characters.selected) ?? '';
  return (ownsCharacter(game, id) ? characterById(id) : undefined) ?? defaultCharacter();
}

/** The BODY being played — the toggle on the דמות screen reads this. */
export function selectedBody(game: GameState): BodyGeometry {
  return selectedCharacter(game).geometry;
}

/** The SKIN being worn right now. */
export function selectedSkin(game: GameState): SkinDef {
  return skinOf(selectedCharacter(game).skin) ?? (SKINS[0] as SkinDef);
}

/** Key of one payout slot — the anti-farming guard. */
export function grantKey(date: string, exId: string, setIndex: number): string {
  return `${date}|${exId}|${setIndex}`;
}

/** Idempotency key of the energy paid for the completion bonus of a date. */
export function bonusEnergyKey(date: string): string {
  return `bonus|${date}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBodyPart(v: string): v is BodyPart {
  return (BODY_PARTS as readonly string[]).includes(v);
}

function isEquipmentSlot(v: string): v is EquipmentSlot {
  return (EQUIPMENT_SLOTS as readonly string[]).includes(v);
}

/**
 * Fold ONE event into the game state (in place).
 *
 * Only the "authoritative" events change state: `xp_gained`, `energy_gained`,
 * `pr_achieved` (a counter) and `data_cleared` (a reset). `level_up` and
 * `streak_changed` are informational — levels and tiers are DERIVED, so folding
 * them would be double bookkeeping; they exist for the history feed and the UI.
 *
 * IDEMPOTENCY (merge safety)
 * --------------------------
 * The reducer is idempotent per SEMANTIC key, not per event id. Two devices that
 * imported the same legacy file each generated their own retro grants: identical
 * meaning, different uuids. Folding the union of both logs must pay exactly
 * once, so every paying branch checks its ledger BEFORE it adds anything:
 *   `xp_gained` set   -> game.granted[date|exId|setIndex]
 *   `xp_gained` bonus -> game.bonusDays[date]
 *   `pr_achieved`     -> game.prKeys[date|exId|setIndex]
 *   `energy_gained`   -> game.energyGranted[payload.key]
 * An `energy_gained` without a `key` predates v4 and is applied unguarded — old
 * single-device logs replay exactly as they always did.
 *
 * DEV GRANTS (Phase 9)
 * --------------------
 * A `dev: true` payload is an ordinary event that happens to have come from the
 * dev panel rather than from training. Three rules cover all of them:
 *   1. it marks the save (`devUsed`) — that is the ghost's 🛠 flag;
 *   2. it is idempotent by its own `dev|<uuid>` key (`devKeys`, or the existing
 *      `energyGranted` ledger for energy), because it has no natural slot;
 *   3. it never adds a workout day — a grant is not training, and the streak is
 *      the one number that has to keep meaning "I turned up".
 * Purged grants never reach this function at all (see `liveEvents`), which is
 * what makes `devUsed` mean "an UNCOVERED dev grant exists".
 */
export function applyGameEvent(game: GameState, type: EventType, payload: Record<string, unknown>): void {
  // A dev GRANT marks the save. `dev_purge` is dev-marked too (the feed shows it
  // as one), but it is a removal, not a grant: it must not flag what it clears.
  if (payload['dev'] === true && type !== 'dev_purge') game.devUsed = true;
  const devKey = payload['dev'] === true && typeof payload['key'] === 'string' ? payload['key'] : '';

  switch (type) {
    case 'xp_gained': {
      const date = typeof payload['date'] === 'string' ? payload['date'] : '';
      const exId = typeof payload['exId'] === 'string' ? payload['exId'] : '';
      const setIndex = typeof payload['setIndex'] === 'number' ? payload['setIndex'] : -1;
      const key = date && exId && setIndex >= 0 ? grantKey(date, exId, setIndex) : '';
      const bonus = payload['source'] === 'workout_complete';

      // Already paid for this slot / this date: a duplicate from another device.
      if (key && game.granted[key]) break;
      if (bonus && date && game.bonusDays[date]) break;
      // A dev grant has no slot of its own — its key IS the slot.
      if (devKey) {
        if (game.devKeys[devKey]) break;
        game.devKeys[devKey] = true;
      }

      const parts = payload['parts'];
      if (isRecord(parts)) {
        for (const part of Object.keys(parts)) {
          if (!isBodyPart(part)) continue;
          const amount = toNumber(parts[part]);
          if (amount <= 0) continue;
          game.parts[part].xp = round2(game.parts[part].xp + amount);
          game.totalXp = round2(game.totalXp + amount);
        }
      }
      if (key) game.granted[key] = true;

      const volume = toNumber(payload['volume']);
      if (exId && volume > 0) game.best[exId] = Math.max(game.best[exId] ?? 0, volume);

      if (bonus && date) game.bonusDays[date] = true;
      // Retro XP never fed the streak, and neither does dev XP: a grant is not
      // a day you turned up for.
      if (payload['retro'] !== true && payload['dev'] !== true && date && !game.workoutDays.includes(date)) {
        game.workoutDays.push(date);
        game.workoutDays.sort();
      }
      break;
    }
    case 'energy_gained': {
      const key = typeof payload['key'] === 'string' ? payload['key'] : '';
      if (key) {
        if (game.energyGranted[key]) break;
        game.energyGranted[key] = true;
      }
      const amount = toNumber(payload['amount']);
      if (amount > 0) {
        game.energy = round2(game.energy + amount);
        game.energyEarned = round2(game.energyEarned + amount);
      }
      break;
    }
    case 'pr_achieved': {
      const date = typeof payload['date'] === 'string' ? payload['date'] : '';
      const exId = typeof payload['exId'] === 'string' ? payload['exId'] : '';
      const setIndex = typeof payload['setIndex'] === 'number' ? payload['setIndex'] : -1;
      if (date && exId && setIndex >= 0) {
        const key = grantKey(date, exId, setIndex);
        if (game.prKeys[key]) break;
        game.prKeys[key] = true;
      }
      game.prCount += 1;
      break;
    }
    /**
     * One cleared wave: charge the energy, pay the coins, move the marker.
     * The wave/world in the payload is authoritative (the log is the source of
     * truth), so a replay lands on exactly the same spot as the live battle.
     */
    case 'wave_cleared': {
      const b = game.battle;
      const world = Math.max(1, Math.floor(toNumber(payload['world']) || b.world));
      const wave = Math.max(1, Math.floor(toNumber(payload['wave']) || b.wave));
      const spent = Math.max(0, toNumber(payload['energySpent']));
      const coins = Math.max(0, toNumber(payload['coins']));

      game.energy = round2(Math.max(0, game.energy - spent));
      b.coins = round2(b.coins + coins);
      b.wavesCleared += 1;
      if (payload['miniBoss'] === true) b.miniBossesCleared += 1;
      b.world = world;
      b.wave = wave + 1;
      break;
    }
    /**
     * A world boss fell. Same contract as `wave_cleared`: the payload is
     * authoritative, so `nextWorld`/`nextWave` decide where the player lands and
     * an old log keeps replaying identically even if the unlock rule changes.
     * The boss id is recorded once — it is the permanent trophy.
     */
    case 'boss_defeated': {
      const b = game.battle;
      const bossId = typeof payload['bossId'] === 'string' ? payload['bossId'] : '';
      const spent = Math.max(0, toNumber(payload['energySpent']));
      const coins = Math.max(0, toNumber(payload['coins']));

      game.energy = round2(Math.max(0, game.energy - spent));
      b.coins = round2(b.coins + coins);
      if (bossId && !b.bossesDefeated.includes(bossId)) b.bossesDefeated.push(bossId);
      b.world = Math.max(1, Math.floor(toNumber(payload['nextWorld']) || b.world));
      b.wave = Math.max(1, Math.floor(toNumber(payload['nextWave']) || 1));
      break;
    }
    /**
     * A shop purchase. Coins are debited and the item joins `owned` forever —
     * there is no sell-back, so replay is a pure accumulation.
     */
    case 'coins_spent': {
      const b = game.battle;
      const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'] : '';
      const cost = Math.max(0, toNumber(payload['cost']));
      b.coins = round2(Math.max(0, b.coins - cost));
      if (itemId && !game.equipment.owned.includes(itemId)) game.equipment.owned.push(itemId);
      break;
    }
    /**
     * ONE upgrade step on one item: `+N`, paid for once.
     *
     * CONVERGENCE — the rule this whole feature rests on. The level is a
     * HIGH-WATER MARK and the event names the level it REACHES, so the reducer
     * applies it only while the item is BELOW that level, and charges the
     * event's own `cost` only when it applies. Three consequences, all tested:
     *
     *   - a duplicate of a step already taken is a no-op (no double charge),
     *     which is the same "idempotent by semantic key" contract `coins_spent`
     *     and `character_purchased` have — the key here is (itemId, toLevel);
     *   - two devices that each bought "+1" offline write two events with
     *     different uuids and the SAME `toLevel: 1`; folding the union in either
     *     order lands on +1 and charges once;
     *   - a device that reached +2 while the other reached +1 folds to +2 and
     *     pays for each STEP exactly once — what one device would have paid.
     *
     * The price rides in the payload rather than being re-derived, exactly like
     * `boss_defeated`'s landing spot: an old log keeps folding to the same purse
     * even if `BALANCE.upgrades` is retuned later.
     */
    case 'item_upgraded': {
      const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'] : '';
      // Only a REAL item can carry a level — a phantom id would otherwise sit in
      // the ledger for ever and diverge from what `normalizeEquipment` keeps.
      if (!itemId || !equipmentById(itemId)) break;
      const toLevel = clampUpgradeLevel(toNumber(payload['toLevel']));
      if (toLevel < 1) break;
      if (upgradeLevelOf(game.equipment, itemId) >= toLevel) break;
      const cost = Math.max(0, toNumber(payload['cost']));
      game.battle.coins = round2(Math.max(0, game.battle.coins - cost));
      game.equipment.upgrades[itemId] = toLevel;
      break;
    }
    /**
     * ONE daily-challenge run — the only event the feature writes.
     *
     * IDEMPOTENT PER DATE. There is exactly one challenge per calendar date and
     * exactly one attempt at it, so the DATE is the semantic key: the event is
     * applied only while `daily.runs[date]` is empty, and the fee is charged /
     * the coins are paid only when it applies. A duplicate is a total no-op, and
     * two devices that both played the same day offline converge on the run that
     * comes FIRST in the log's `(ts, id)` order — an order that is a property of
     * the event set, so both devices reach the same record and pay exactly once,
     * whichever order the events arrived in.
     *
     * The payload is authoritative (coins and fee ride in it), so a retune of
     * `BALANCE.daily` never rewrites history.
     */
    case 'daily_challenge': {
      const date = typeof payload['date'] === 'string' ? payload['date'] : '';
      if (!date) break;
      const d = game.daily;
      if (d.runs[date]) break;

      const spent = Math.max(0, toNumber(payload['energySpent']));
      const coins = Math.max(0, toNumber(payload['coins']));
      const score = Math.max(0, Math.floor(toNumber(payload['score'] ?? payload['wavesCleared'])));
      game.energy = round2(Math.max(0, game.energy - spent));
      game.battle.coins = round2(game.battle.coins + coins);
      d.runs[date] = {
        score,
        tiebreak: Math.max(0, toNumber(payload['tiebreak'])),
        coins,
        complete: payload['complete'] === true,
      };
      break;
    }
    /**
     * ONE ghost duel — the only event the feature writes.
     *
     * IDEMPOTENT PER (DATE, OPPONENT). The key is DERIVED here from the payload
     * (`duelKey`), never carried in it, so a crafted event cannot claim a slot
     * that does not match its own contents; the event applies only while that
     * slot is empty, and the fee is charged only when it applies. A duplicate is
     * a total no-op, and two devices that both fought the same person offline
     * converge on the run that comes FIRST in the log's `(ts, id)` order.
     *
     * NO COINS. Not "zero coins in the payload" — the branch does not read a
     * coin field at all, so no version of this event, however it was written or
     * crafted, can ever add to the purse. Two accounts cannot farm each other.
     *
     * The result is authoritative: a replay reproduces the record from the
     * event, never by re-simulating a fight whose opponent has since retrained.
     */
    case 'ghost_duel': {
      const date = typeof payload['date'] === 'string' ? payload['date'] : '';
      const opponent = normalizeHandle(payload['opponentHandle']);
      if (!date || !opponent) break;
      const key = duelKey(date, opponent);
      const d = game.duels;
      if (d.runs[key]) break;

      const spent = Math.max(0, toNumber(payload['energySpent']));
      game.energy = round2(Math.max(0, game.energy - spent));
      d.runs[key] = {
        opponent,
        won: payload['won'] === true,
        score: payload['won'] === true ? 1 : 0,
        tiebreak: clamp(toNumber(payload['tiebreak']), 0, 100),
      };
      break;
    }
    /** Put an item on, or (with `itemId: null`) take the slot's item off. */
    case 'item_equipped': {
      const slot = typeof payload['slot'] === 'string' ? payload['slot'] : '';
      if (!isEquipmentSlot(slot)) break;
      const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'] : null;
      if (itemId === null) delete game.equipment.equipped[slot];
      else game.equipment.equipped[slot] = itemId;
      break;
    }
    /**
     * A cosmetic skin was bought. Idempotent by SKIN ID, not by event id: the
     * union of two devices' logs may hold two purchases of the same skin with
     * different uuids, and the purse may only be charged once.
     *
     * ONE PURCHASE, BOTH BODIES: what lands in `characters.owned` is the skin,
     * never a body-specific combination, so `robot` unlocks `robot_m` and
     * `robot_f` together. `skinOf` accepts either shape, which is exactly what
     * makes a pre-matrix `character_purchased: 'ninja'` fold into the ninja skin
     * on both bodies without rewriting a single stored event.
     *
     * A free skin can never be purchased (`buildCharacterPurchase` refuses, and
     * the reducer refuses too) — the base look is owned by definition, so a
     * crafted event cannot make the player pay for one.
     */
    case 'character_purchased': {
      const id = typeof payload['characterId'] === 'string' ? payload['characterId'] : '';
      const skin = id ? skinOf(id) : undefined;
      if (!skin || skin.cost <= 0) break;
      if (game.characters.owned.includes(skin.id)) break;
      const cost = Math.max(0, toNumber(payload['cost']));
      game.battle.coins = round2(Math.max(0, game.battle.coins - cost));
      game.characters.owned.push(skin.id);
      break;
    }
    /**
     * Switch the combination being played — the ONE event behind both "wear
     * another skin" and "switch body", because a body and a skin are never
     * chosen separately: you always play exactly one `<skin>_<body>` pair, so a
     * second event (a `body_selected`) could only ever disagree with this one
     * after a merge. Last one in the total `(ts, id)` order wins, which is what
     * makes two devices converge.
     *
     * A legacy id is resolved first (`'robot'` → `'robot_m'`, `'hero_f'` →
     * itself), and an id that is unknown, or whose skin this save never bought,
     * is IGNORED rather than stored — the drawing must always be something the
     * player actually owns.
     */
    case 'character_selected': {
      const raw = typeof payload['characterId'] === 'string' ? payload['characterId'] : '';
      const id = raw ? resolveCharacterId(raw) : undefined;
      if (!id || !ownsCharacter(game, id)) break;
      game.characters.selected = id;
      break;
    }
    /**
     * Coins from outside the battle economy — today, only a dev grant.
     *
     * The `key` is REQUIRED, not optional: it is the only thing that keeps the
     * purse right after a merge, so an unkeyed grant pays nothing at all rather
     * than paying twice.
     */
    case 'coins_granted': {
      const key = typeof payload['key'] === 'string' ? payload['key'] : '';
      if (!key || game.devKeys[key]) break;
      game.devKeys[key] = true;
      const amount = Math.max(0, toNumber(payload['amount']));
      if (amount > 0) game.battle.coins = round2(game.battle.coins + amount);
      break;
    }
    /**
     * Re-open one day's ledger (the daily challenge, or the duels) so it can be
     * played again — the dev panel's "אפס" buttons.
     *
     * HIGH-WATER BY CYCLE, exactly like `item_upgraded`: the event names the
     * cycle it opens and it applies only while the ledger is below it. Two
     * devices that each opened cycle 1 offline therefore converge on ONE extra
     * attempt in either merge order, and the "one attempt per cycle" rule keeps
     * holding — the entry a later run writes simply lands in the empty slot.
     */
    case 'dev_reset': {
      const date = typeof payload['date'] === 'string' ? payload['date'] : '';
      const scope = payload['scope'];
      if (!date || (scope !== 'daily' && scope !== 'duels')) break;
      const cycle = Math.floor(toNumber(payload['cycle']));
      if (cycle < 1) break;
      const ledgerKey = `${scope}|${date}`;
      if ((game.devCycles[ledgerKey] ?? 0) >= cycle) break;
      game.devCycles[ledgerKey] = cycle;
      if (scope === 'daily') {
        delete game.daily.runs[date];
      } else {
        for (const key of Object.keys(game.duels.runs)) {
          if (key.startsWith(`${date}|`)) delete game.duels.runs[key];
        }
      }
      break;
    }
    /**
     * A purge changes nothing HERE. It works by omission: `liveEvents` drops
     * every dev grant that sorts before it, so by the time the fold runs there
     * is nothing left to undo. Folding it is a no-op on purpose — that is what
     * makes "purged" and "never granted" the same state, byte for byte.
     */
    case 'dev_purge':
      break;
    case 'data_cleared': {
      const fresh = emptyGame();
      Object.assign(game, fresh);
      break;
    }
    // Derived / not owned by the game state — see the doc comment above.
    default:
      break;
  }
}

/**
 * Recompute every derived field (levels, headline level, streak).
 *
 * `targets` is the plan's weekly-target history (`weeklyTargetsFromEvents`).
 * The live path and the replay path MUST pass the same one — that is the whole
 * reason it is a parameter rather than something read from the state.
 */
export function finalizeGame(game: GameState, today: string, targets: WeeklyTargets = []): void {
  for (const part of BODY_PARTS) {
    game.parts[part].level = levelForXp(game.parts[part].xp);
  }
  game.level = characterLevel(game.parts);
  game.streak = computeStreak(game.workoutDays, today, targets);
  finalizeDaily(game.daily, today);
  finalizeDuels(game.duels);
}

/**
 * Recompute every duel total from the per-(date, opponent) ledger.
 *
 * DERIVED, not folded — the same rule as the daily challenge's totals and the
 * body-part levels. Lifetime W/L, and W/L against each opponent, are pure
 * functions of a map that unions exactly, so they cannot drift after a merge
 * however many duplicate events arrive.
 */
export function finalizeDuels(duels: GhostDuelState): void {
  const byOpponent: Record<string, { wins: number; losses: number; duels: number }> = {};
  let wins = 0;
  let losses = 0;

  for (const key of Object.keys(duels.runs).sort()) {
    const run = duels.runs[key] as GhostDuelRecord;
    const tally = byOpponent[run.opponent] ?? { wins: 0, losses: 0, duels: 0 };
    tally.duels += 1;
    if (run.won) {
      tally.wins += 1;
      wins += 1;
    } else {
      tally.losses += 1;
      losses += 1;
    }
    byOpponent[run.opponent] = tally;
  }

  duels.duels = wins + losses;
  duels.wins = wins;
  duels.losses = losses;
  duels.byOpponent = byOpponent;
}

/**
 * Recompute every daily-challenge total from the per-date ledger.
 *
 * DERIVED, not folded — for the same reason levels are: a field computed from
 * the ledger cannot disagree with the log after a merge, whereas a counter
 * incremented per event would have to be defended against every duplicate. The
 * ledger itself is the only thing the reducer touches, and it is a map keyed by
 * date, which unions exactly.
 */
export function finalizeDaily(daily: DailyChallengeState, today: string): void {
  const dates = Object.keys(daily.runs).sort();
  let completed = 0;
  let bestScore = 0;
  let bestTiebreak = 0;
  let bestDate: string | null = null;

  for (const date of dates) {
    const run = daily.runs[date] as DailyRunRecord;
    if (run.complete) completed += 1;
    // Ties on the score are broken by the health the run ended on; a tie on both
    // keeps the EARLIER date, so the record has one unambiguous owner.
    if (run.score > bestScore || (run.score === bestScore && run.tiebreak > bestTiebreak)) {
      bestScore = run.score;
      bestTiebreak = run.tiebreak;
      bestDate = date;
    }
  }

  daily.attempts = dates.length;
  daily.completed = completed;
  daily.bestScore = bestScore;
  daily.bestTiebreak = bestTiebreak;
  daily.bestDate = bestDate;
  daily.streak = dailyStreak(dates, today);
  daily.bestStreak = bestDailyStreak(dates);
}

/**
 * THE total order of the event log: `ts` ascending, ties broken by `id`.
 *
 * The id tie-break is what makes the order a property of the event SET rather
 * than of the insertion order, so two devices that hold the same events fold
 * them identically no matter how or when each of them received them.
 */
export function compareEvents(a: AppEvent, b: AppEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * THE PURGE PRE-PASS: the events that still count, in fold order.
 *
 * A `dev_purge` takes back every dev GRANT that sorts before it in the total
 * `(ts, id)` order — so the fold simply never sees them, and the state that
 * comes out is byte-identical to the state of a log that never had them. That
 * is the whole implementation of "undo my dev grants", and it is why the undo is
 * exact rather than an approximate counter-grant:
 *
 *   - only the LAST purge matters (an earlier one covers a subset);
 *   - a dev grant written AFTER it applies normally — purge, then keep testing;
 *   - it is idempotent (a second purge covers the same nothing) and it converges
 *     under a union merge, because "before" is a property of the event SET;
 *   - real events are never touched, wherever they sit. Coins won in a battle
 *     that dev energy paid for stay won: this reverts grants, not history.
 *
 * `input` may be in any order; the returned array is sorted.
 */
export function liveEvents(input: readonly AppEvent[]): AppEvent[] {
  const ordered = [...input].sort(compareEvents);
  let lastPurge = -1;
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i]?.type === 'dev_purge') lastPurge = i;
  }
  if (lastPurge < 0) return ordered;
  return ordered.filter((ev, i) => i > lastPurge || ev.payload['dev'] !== true);
}

/**
 * Deterministically rebuild the whole game layer from the event log.
 *
 * The plan events are folded here TOO (as the weekly-target history), because
 * the streak threshold of a past week is part of the game layer's answer and it
 * must come from the same totally-ordered log the XP does.
 */
export function rebuildGame(events: readonly AppEvent[], today: string): GameState {
  const game = emptyGame();
  const ordered = liveEvents(events);
  for (const ev of ordered) applyGameEvent(game, ev.type, ev.payload);
  finalizeGame(game, today, weeklyTargetsFromEvents(ordered));
  return game;
}

/* --------------------------------------------------------- grant builders */

/** An event that is about to be appended: `{type, payload}` plus its timestamp. */
export interface PendingEvent {
  type: EventType;
  payload: Record<string, unknown>;
  ts: number;
}

/**
 * The `level_up` markers for a batch of part gains — informational events the
 * feed reads (levels themselves are always DERIVED from XP).
 *
 * Exported because the dev grants (`core/dev.ts`) celebrate a level exactly like
 * a real set does; `dev: true` is carried through so the feed can say where the
 * level came from.
 */
export function levelUpEvents(
  before: PartsProgress,
  parts: Partial<Record<BodyPart, number>>,
  meta: { date: string; retro: boolean; ts: number; dev?: true },
): PendingEvent[] {
  const out: PendingEvent[] = [];
  let offset = 0;
  for (const part of BODY_PARTS) {
    const gain = parts[part];
    if (!gain || gain <= 0) continue;
    const from = levelForXp(before[part].xp);
    const to = levelForXp(before[part].xp + gain);
    if (to > from) {
      out.push({
        type: 'level_up',
        payload: { date: meta.date, part, from, to, retro: meta.retro, ...(meta.dev ? { dev: true } : {}) },
        ts: meta.ts + offset,
      });
      offset += 1;
    }
  }
  return out;
}

export interface SetGrantArgs {
  date: string;
  day: DayKey;
  ex: Exercise;
  setIndex: number;
  w: string;
  r: string;
  /** Retro grants pay XP + PRs but no energy and no streak day. */
  retro: boolean;
  /** Timestamp of the first emitted event (siblings get +1ms each). */
  ts: number;
}

/**
 * Events for completing ONE set. Returns `[]` when this exact
 * (date, exercise, set) already paid out — the anti-farming guard.
 */
export function buildSetGrant(game: GameState, a: SetGrantArgs): PendingEvent[] {
  if (game.granted[grantKey(a.date, a.ex.id, a.setIndex)]) return [];

  const volume = setVolume(a.w, a.r);
  const previousBest = game.best[a.ex.id] ?? 0;
  const res = xpForSet(volume, previousBest);
  const parts = splitXp(res.xp, a.ex);

  const events: PendingEvent[] = [
    {
      type: 'xp_gained',
      payload: {
        date: a.date,
        day: a.day,
        exId: a.ex.id,
        setIndex: a.setIndex,
        source: 'set',
        parts,
        total: res.xp,
        volume,
        factor: res.factor,
        pr: res.pr,
        retro: a.retro,
      },
      ts: a.ts,
    },
  ];
  if (res.pr) {
    events.push({
      type: 'pr_achieved',
      payload: {
        date: a.date,
        exId: a.ex.id,
        setIndex: a.setIndex,
        volume,
        previousBest,
        retro: a.retro,
      },
      ts: a.ts + 1,
    });
  }
  if (!a.retro) {
    events.push({
      type: 'energy_gained',
      payload: {
        date: a.date,
        amount: BALANCE.energy.perSet,
        source: 'set',
        retro: false,
        key: grantKey(a.date, a.ex.id, a.setIndex),
      },
      ts: a.ts + 2,
    });
  }
  events.push(...levelUpEvents(game.parts, parts, { date: a.date, retro: a.retro, ts: a.ts + 3 }));
  return events;
}

export interface WorkoutGrantArgs {
  date: string;
  day: DayKey;
  retro: boolean;
  ts: number;
}

/**
 * Events for finishing every set of every exercise of a day: a flat XP bonus to
 * EVERY body part plus bonus battle energy. Guarded once per date.
 */
export function buildWorkoutCompletionGrant(game: GameState, a: WorkoutGrantArgs): PendingEvent[] {
  if (game.bonusDays[a.date]) return [];
  const parts = completionSplit();
  let total = 0;
  for (const part of BODY_PARTS) total = round2(total + (parts[part] ?? 0));

  const events: PendingEvent[] = [
    {
      type: 'xp_gained',
      payload: {
        date: a.date,
        day: a.day,
        source: 'workout_complete',
        parts,
        total,
        retro: a.retro,
      },
      ts: a.ts,
    },
  ];
  if (!a.retro) {
    events.push({
      type: 'energy_gained',
      payload: {
        date: a.date,
        amount: BALANCE.energy.perWorkout,
        source: 'workout_complete',
        retro: false,
        key: bonusEnergyKey(a.date),
      },
      ts: a.ts + 1,
    });
  }
  events.push(...levelUpEvents(game.parts, parts, { date: a.date, retro: a.retro, ts: a.ts + 2 }));
  return events;
}

/** Apply a batch of pending events to a game state (used by both paths). */
export function applyPending(game: GameState, events: readonly PendingEvent[]): void {
  for (const e of events) applyGameEvent(game, e.type, e.payload);
}

/* ----------------------------------------------------- retroactive grants */

function doneSetsOf(arr: readonly (SetEntry | null)[] | undefined): number[] {
  if (!arr) return [];
  const out: number[] = [];
  arr.forEach((s, i) => {
    if (s?.done) out.push(i);
  });
  return out;
}

/**
 * True when every set of every exercise of the session's day is checked.
 *
 * A session whose day the program does not have (a plan day that was deleted, or
 * one this build has never heard of) can never be "complete": there is no list
 * of exercises to have finished, and paying a completion bonus for an empty list
 * would be a bug, not a gift.
 */
function sessionComplete(session: Session, program: ResolvedProgram): boolean {
  const day = dayOf(program, session.day);
  if (!day) return false;
  return day.exercises.every((ex) => doneSetsOf(session.ex[ex.id]).length >= ex.sets);
}

/** Program order first (stable + meaningful), then any unknown ids, sorted. */
function exerciseOrder(session: Session, program: ResolvedProgram): string[] {
  const day = dayOf(program, session.day);
  const inProgram = (day?.exercises ?? []).map((e) => e.id).filter((id) => session.ex[id]);
  const rest = Object.keys(session.ex)
    .filter((id) => !inProgram.includes(id))
    .sort();
  return [...inProgram, ...rest];
}

/**
 * How a retro pass sees the world. Both default to the BUILT-IN program, so a
 * caller that knows nothing about plans behaves exactly as it did before.
 */
export interface RetroGrantOptions {
  /**
   * Exercise lookup. A plan-aware resolver (`makeResolver`) is what lets a set
   * of a CUSTOM exercise pay XP into the right body parts — with the built-in
   * `findExercise` the set would simply be skipped.
   */
  resolve?: ExerciseResolver;
  /** Day layout, used for the ordering and the completion bonus. */
  program?: ResolvedProgram;
}

/**
 * Generate the XP grants for history that never went through the game layer
 * (legacy import, JSON import, or workouts logged under Phase 0).
 *
 * Deterministic: dates ascending, exercises in program order, sets by index.
 * Each event is stamped at its own workout date (00:00 UTC + a per-event offset)
 * so the log stays chronological and `best`/PR detection replays correctly.
 * Already-granted sets are skipped, so running this twice is a no-op.
 */
export function buildRetroactiveGrants(
  sessions: Readonly<Record<string, Session>>,
  existing: readonly AppEvent[],
  today: string,
  options: RetroGrantOptions = {},
): PendingEvent[] {
  const resolve = options.resolve ?? findExercise;
  const program = options.program ?? BUILTIN_PROGRAM;
  const scratch = rebuildGame(existing, today);
  const out: PendingEvent[] = [];

  for (const date of Object.keys(sessions).sort()) {
    const session = sessions[date];
    if (!session) continue;
    let offset = 0;
    const baseTs = isoToTs(date);

    for (const exId of exerciseOrder(session, program)) {
      const ex = resolve(exId);
      if (!ex) continue; // an exercise the program no longer has — no XP mapping
      for (const setIndex of doneSetsOf(session.ex[exId])) {
        const entry = session.ex[exId]?.[setIndex];
        if (!entry) continue;
        const events = buildSetGrant(scratch, {
          date,
          day: session.day,
          ex,
          setIndex,
          w: entry.w,
          r: entry.r,
          retro: true,
          ts: baseTs + offset,
        });
        if (events.length === 0) continue;
        offset += 10;
        applyPending(scratch, events);
        out.push(...events);
      }
    }

    if (sessionComplete(session, program)) {
      const bonus = buildWorkoutCompletionGrant(scratch, {
        date,
        day: session.day,
        retro: true,
        ts: baseTs + offset,
      });
      if (bonus.length > 0) {
        applyPending(scratch, bonus);
        out.push(...bonus);
      }
    }
  }

  return out;
}

/* ------------------------------------------------------- derived stats */

/**
 * PROVISIONAL combat stats derived from the six part levels + the streak buff.
 * Phase 1 only DISPLAYS these; Phase 2 (`core/combat.ts`) consumes them.
 */
export interface CharacterStats {
  /** chest */ atk: number;
  /** back */ def: number;
  /** legs */ maxHp: number;
  /** shoulders — ms between auto attacks (lower is faster) */ attackIntervalMs: number;
  /** arms */ critChance: number;
  /** arms */ critMultiplier: number;
  /** core — hp per tick */ regen: number;
  /** `1 + 0.1 × streak tier`, already applied to the numbers above. */
  buff: number;
}

/**
 * The six part levels + the streak buff + (Phase 3) the equipped gear.
 *
 * ORDER MATTERS and is deliberate: the gear bonus is added to the level-derived
 * value and the streak buff multiplies the SUM, so a perfect week makes your
 * equipment better too. Equipment can never carry the character on its own —
 * the level term is always the dominant one.
 */
export function deriveStats(
  parts: PartsProgress,
  streakTier: number,
  bonus: ResolvedBonus = zeroBonus(),
): CharacterStats {
  const s = BALANCE.stats;
  const buff = streakMultiplier(streakTier);
  const lv = (p: BodyPart): number => Math.max(0, parts[p].level - 1);
  return {
    atk: round2((s.atkBase + s.atkPerLevel * lv('chest') + bonus.atk) * buff),
    def: round2((s.defBase + s.defPerLevel * lv('back') + bonus.def) * buff),
    maxHp: Math.round((s.hpBase + s.hpPerLevel * lv('legs') + bonus.hp) * buff),
    attackIntervalMs: Math.round(
      Math.max(
        s.attackIntervalMinMs,
        s.attackIntervalBaseMs + bonus.attackIntervalMs - s.attackIntervalPerLevelMs * lv('shoulders') * buff,
      ),
    ),
    critChance: round2(
      Math.min(s.critChanceMax, (s.critChanceBase + s.critChancePerLevel * lv('arms') + bonus.critChance) * buff),
    ),
    critMultiplier: round2((s.critMultiplierBase + s.critMultiplierPerLevel * lv('arms') + bonus.critMultiplier) * buff),
    regen: round2((s.regenBase + s.regenPerLevel * lv('core') + bonus.regen) * buff),
    buff: round2(buff),
  };
}

/** The item ids actually worn right now (a slot may be empty). */
export function equippedIds(game: GameState): string[] {
  const out: string[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const id = game.equipment.equipped[slot];
    if (id && equipmentById(id)) out.push(id);
  }
  return out;
}

/**
 * The summed bonus of everything currently worn, AT ITS UPGRADE LEVEL.
 *
 * This is the single point the upgrade economy enters the stat sheet: every
 * consumer (the דמות stat grid, the battle engine, the six body-part skills that
 * scale off ATK/DEF) reads its numbers through here, so an upgrade is felt
 * everywhere without a line of code in any of them.
 */
export function equippedBonus(game: GameState): ResolvedBonus {
  return sumEquipBonus(equippedIds(game), (id) => upgradeMultiplier(upgradeLevelOf(game.equipment, id)));
}

/** THE stat function the UI and the battle engine both call. */
export function statsOfGame(game: GameState): CharacterStats {
  return deriveStats(game.parts, game.streak.tier, equippedBonus(game));
}

/* ------------------------------------------------------------- shop rules */

/** Why a purchase was refused — the UI turns this into Hebrew. */
export type PurchaseError = 'unknown_item' | 'already_owned' | 'insufficient_coins';

export interface PurchasePlan {
  ok: boolean;
  error?: PurchaseError;
  events: PendingEvent[];
}

/**
 * Plan a shop purchase. PURE: it decides, it does not spend. The coin check
 * lives here (not in the UI) so a replay of the log can never produce a negative
 * purse and a crafted click cannot buy something the player cannot afford.
 */
export function buildPurchase(game: GameState, itemId: string, date: string, ts: number): PurchasePlan {
  const def = equipmentById(itemId);
  if (!def) return { ok: false, error: 'unknown_item', events: [] };
  if (game.equipment.owned.includes(itemId)) return { ok: false, error: 'already_owned', events: [] };
  if (game.battle.coins < def.cost) return { ok: false, error: 'insufficient_coins', events: [] };
  return {
    ok: true,
    events: [
      { type: 'coins_spent', payload: { date, itemId, slot: def.slot, cost: def.cost }, ts },
      // Buying always equips: one tap, one obvious result.
      { type: 'item_equipped', payload: { date, slot: def.slot, itemId }, ts: ts + 1 },
    ],
  };
}

/* -------------------------------------------------------- upgrade rules */

/** Why an upgrade was refused — the UI turns this into Hebrew. */
export type UpgradeError = 'unknown_item' | 'not_owned' | 'max_level' | 'insufficient_coins';

export interface UpgradePlan {
  ok: boolean;
  error?: UpgradeError;
  /** The level this plan would reach (0 when it was refused). */
  toLevel: number;
  /** Price of that one step (0 when it was refused). */
  cost: number;
  events: PendingEvent[];
}

const REFUSED = (error: UpgradeError): UpgradePlan => ({ ok: false, error, toLevel: 0, cost: 0, events: [] });

/**
 * Plan ONE upgrade step. PURE: it decides, it does not spend.
 *
 * Same contract as `buildPurchase` — the affordability check lives HERE, before
 * anything reaches the log, so a refused upgrade leaves no trace and a replay
 * can never produce a negative purse. Only an OWNED item can be upgraded (the
 * upgrade rides on a purchase, it is not a way to skip one), and only one step
 * at a time: the log then reads as the ladder the player actually climbed.
 */
export function buildUpgrade(game: GameState, itemId: string, date: string, ts: number): UpgradePlan {
  const def = equipmentById(itemId);
  if (!def) return REFUSED('unknown_item');
  if (!game.equipment.owned.includes(itemId)) return REFUSED('not_owned');
  const toLevel = upgradeLevelOf(game.equipment, itemId) + 1;
  if (toLevel > MAX_UPGRADE_LEVEL) return REFUSED('max_level');
  const cost = upgradeStepCost(def.cost, toLevel);
  if (game.battle.coins < cost) return REFUSED('insufficient_coins');
  return {
    ok: true,
    toLevel,
    cost,
    events: [
      { type: 'item_upgraded', payload: { date, itemId, slot: def.slot, toLevel, cost }, ts },
    ],
  };
}

/* ------------------------------------------------- daily challenge rules */

/** Why today's challenge cannot be entered — the UI turns this into Hebrew. */
export type DailyEntryError = 'already_played' | 'insufficient_energy';

export interface DailyEntryStatus {
  ok: boolean;
  error?: DailyEntryError;
  /** ⚡ the attempt costs. */
  energyCost: number;
  /** The run already counted for that date, or `null` when it is still open. */
  record: DailyRunRecord | null;
}

/**
 * May this save start `date`'s challenge? PURE — it decides, it does not spend.
 *
 * Both refusals are checked HERE, before a run is even created, so an attempt
 * that cannot happen leaves no trace anywhere: no event, no fee, no coins. The
 * "one attempt per date" half of the rule is enforced twice on purpose — here so
 * the UI can explain it, and again in the reducer so a crafted or duplicated
 * event can never buy a second run.
 */
export function dailyEntryStatus(game: GameState, date: string): DailyEntryStatus {
  const energyCost = BALANCE.daily.entryEnergy;
  const record = game.daily.runs[date] ?? null;
  if (record) return { ok: false, error: 'already_played', energyCost, record };
  if (game.energy < energyCost) return { ok: false, error: 'insufficient_energy', energyCost, record: null };
  return { ok: true, energyCost, record: null };
}

/**
 * The event for a run that just ended. Returns `[]` when that date already has
 * a counted attempt, so a second write is impossible even if the UI asked for
 * one (a forfeit racing the finale, a double tap, a replayed callback).
 */
export function buildDailyChallenge(
  game: GameState,
  result: ChallengeResult,
  ts: number,
): PendingEvent[] {
  if (game.daily.runs[result.date]) return [];
  const payload: DailyChallengePayload = {
    date: result.date,
    seed: result.seed,
    wavesCleared: result.wavesCleared,
    score: result.score,
    tiebreak: result.tiebreak,
    coins: result.coins,
    energySpent: result.energySpent,
    complete: result.complete,
    outcome: result.outcome,
    durationMs: result.durationMs,
  };
  return [{ type: 'daily_challenge', payload, ts }];
}

/* ------------------------------------------------------ ghost duel rules */

/** Why a duel cannot start — the UI turns this into Hebrew. */
export type DuelEntryError = 'no_opponent' | 'already_dueled' | 'insufficient_energy';

export interface DuelEntryStatus {
  ok: boolean;
  error?: DuelEntryError;
  /** ⚡ the duel costs. */
  energyCost: number;
  /** The duel already counted against that opponent today, or `null`. */
  record: GhostDuelRecord | null;
  /** Lifetime record against them, for the preview card. */
  tally: { wins: number; losses: number; duels: number };
}

/**
 * May this save duel `opponentHandle` on `date`? PURE — it decides, it does not
 * spend.
 *
 * Every refusal is checked HERE, before a run is created, so a duel that cannot
 * happen leaves no trace anywhere: no event, no fee. The "one per opponent per
 * day" half is enforced twice on purpose — here so the UI can explain it, and
 * again in the reducer so a duplicated or crafted event cannot buy a second one.
 */
export function duelEntryStatus(game: GameState, date: string, opponentHandle: string): DuelEntryStatus {
  const energyCost = BALANCE.duel.entryEnergy;
  const handle = normalizeHandle(opponentHandle);
  const tally = game.duels.byOpponent[handle] ?? { wins: 0, losses: 0, duels: 0 };
  if (!handle) return { ok: false, error: 'no_opponent', energyCost, record: null, tally };
  const record = game.duels.runs[duelKey(date, handle)] ?? null;
  if (record) return { ok: false, error: 'already_dueled', energyCost, record, tally };
  if (game.energy < energyCost) {
    return { ok: false, error: 'insufficient_energy', energyCost, record: null, tally };
  }
  return { ok: true, energyCost, record: null, tally };
}

/**
 * The event for a duel that just ended. Returns `[]` when that (date, opponent)
 * pair already has a counted duel, so a second write is impossible even if the
 * UI asked for one (a forfeit racing the finish, a double tap, a replayed
 * callback).
 */
export function buildGhostDuel(
  game: GameState,
  result: ChallengeResult,
  snapshotHash: string,
  ts: number,
): PendingEvent[] {
  const opponent = result.opponent;
  if (!opponent) return [];
  const handle = normalizeHandle(opponent.handle);
  if (!handle) return [];
  if (game.duels.runs[duelKey(result.date, handle)]) return [];
  const payload: GhostDuelPayload = {
    date: result.date,
    opponentHandle: handle,
    opponentName: opponent.name,
    won: result.won === true,
    score: result.won === true ? 1 : 0,
    tiebreak: result.tiebreak,
    seed: result.seed,
    energySpent: result.energySpent,
    snapshotHash,
    outcome: result.outcome,
    durationMs: result.durationMs,
  };
  return [{ type: 'ghost_duel', payload, ts }];
}

/* ---------------------------------------------------------- the roster */

/** Why a character purchase was refused — the UI turns this into Hebrew. */
export type CharacterPurchaseError = 'unknown_character' | 'already_owned' | 'insufficient_coins';

export interface CharacterPurchasePlan {
  ok: boolean;
  error?: CharacterPurchaseError;
  events: PendingEvent[];
}

/**
 * Plan a SKIN purchase. PURE — it decides, it does not spend.
 *
 * The affordability check lives HERE, exactly like `buildPurchase`, so a refused
 * purchase never reaches the log and a replay can never produce a negative
 * purse. The free base skin reports `already_owned`: there is nothing to buy.
 *
 * `skinId` is the ownership unit — one price, both bodies. A composite id is
 * accepted too (and reduced to its skin), so a caller may pass whatever it has
 * on hand. Buying also SELECTS, mirroring "buying a piece of gear puts it on":
 * one tap, one obvious result — and it selects the new skin ON THE BODY THE
 * PLAYER IS ALREADY PLAYING, never on the body they happen to be previewing
 * from, so a purchase never quietly changes who you are.
 */
export function buildCharacterPurchase(
  game: GameState,
  skinId: string,
  date: string,
  ts: number,
): CharacterPurchasePlan {
  const skin = skinOf(skinId);
  if (!skin) return { ok: false, error: 'unknown_character', events: [] };
  if (ownsSkin(game, skin.id)) return { ok: false, error: 'already_owned', events: [] };
  if (game.battle.coins < skin.cost) return { ok: false, error: 'insufficient_coins', events: [] };
  const wear = characterId(skin.id, selectedBody(game));
  return {
    ok: true,
    events: [
      { type: 'character_purchased', payload: { date, characterId: skin.id, cost: skin.cost }, ts },
      { type: 'character_selected', payload: { date, characterId: wear }, ts: ts + 1 },
    ],
  };
}

/**
 * Plan a switch to one body × skin combination. Only an owned combination can be
 * selected, and re-selecting the current one is a no-op (no event, no log noise).
 */
export function buildCharacterSelect(
  game: GameState,
  charId: string,
  date: string,
  ts: number,
): PendingEvent[] {
  const id = resolveCharacterId(charId);
  if (!id || !ownsCharacter(game, id)) return [];
  if (game.characters.selected === id) return [];
  return [{ type: 'character_selected', payload: { date, characterId: id }, ts }];
}

/**
 * Plan a BODY switch: the same skin, the other silhouette.
 *
 * Bodies are free and always available, so this can only fail by being a no-op.
 * It deliberately reuses `character_selected` rather than introducing a
 * `body_selected`: the player plays exactly ONE combination, and two events
 * describing halves of it could disagree after a merge.
 */
export function buildBodySelect(
  game: GameState,
  body: BodyGeometry,
  date: string,
  ts: number,
): PendingEvent[] {
  return buildCharacterSelect(game, characterId(selectedCharacter(game).skin, body), date, ts);
}

/** Every combination the save can play right now, in roster order. */
export function availableCharacters(game: GameState): readonly CharacterDef[] {
  return CHARACTERS.filter((c) => ownsCharacter(game, c.id));
}

/** Every skin the save owns, in roster (= price) order. */
export function availableSkins(game: GameState): readonly SkinDef[] {
  return SKINS.filter((s) => ownsSkin(game, s.id));
}

/**
 * Plan an equip (`itemId`) or unequip (`null`). Only OWNED items can be worn,
 * and re-equipping what is already on is a no-op (no event, no log noise).
 */
export function buildEquip(
  game: GameState,
  slot: EquipmentSlot,
  itemId: string | null,
  date: string,
  ts: number,
): PendingEvent[] {
  if (itemId !== null) {
    const def = equipmentById(itemId);
    if (!def || def.slot !== slot || !game.equipment.owned.includes(itemId)) return [];
  }
  const current = game.equipment.equipped[slot] ?? null;
  if (current === itemId) return [];
  return [{ type: 'item_equipped', payload: { date, slot, itemId }, ts }];
}
