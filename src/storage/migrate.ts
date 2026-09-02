/**
 * migrate.ts — versioning, legacy import and event replay.
 *
 * EVERY read of persisted data goes through here. Both stored blobs carry a
 * `schemaVersion`; `migrateState` / `migrateEventLog` route an unknown blob
 * through the chain of upgrades up to the current version.
 *
 * Legacy import (`hyp3_data_v1`) is LOSSLESS: every date, day letter, exercise
 * id, set slot (including sparse `null` holes), weight/reps strings and done
 * flag survives. Each imported session additionally produces a
 * `session_imported` event carrying the full set data, so Phase 1 can grant
 * retroactive XP simply by replaying the log — no second parse of legacy data.
 *
 * Phase 1 adds `ensureGameState()`: whenever the `game` blob is missing or from
 * an unknown version it is REBUILT from the log, and any training history that
 * never paid XP gets retroactive grants appended to the log (see core/xp.ts).
 */

import { BODY_PARTS, isDayKey, isReservedViewKey, type BodyPart, type DayKey } from '../data/program.ts';
import { characterById, resolveCharacterId, skinOf, type SkinDef } from '../data/characters.ts';
import { EQUIPMENT_SLOTS, bossById, equipmentById } from '../data/gameContent.ts';
import {
  applyPlanPresetEvent,
  defaultDay,
  defaultTabView,
  isTabView,
  makeResolver,
  normalizePlanDoc,
  normalizeUserPresets,
  planFromEvents,
  resolveProgram,
} from '../core/plan.ts';
import type { PlanDoc } from '../data/planTypes.ts';
import { applyNutritionEvent, emptyNutrition, normalizeNutrition } from '../core/nutrition.ts';
import { todayISO } from '../core/workout.ts';
import {
  buildRetroactiveGrants,
  compareEvents,
  emptyBattle,
  emptyCharacters,
  emptyDaily,
  emptyDuels,
  emptyEquipment,
  emptyGame,
  emptyLeague,
  finalizeDerived,
  isoToTs,
  rebuildGame,
  weekStartISO,
  type PendingEvent,
} from '../core/xp.ts';
import { derivedProgress } from '../core/combat.ts';
import { clampUpgradeLevel } from '../core/upgrades.ts';
import { duelKey, normalizeHandle } from '../core/handle.ts';
import { BALANCE } from '../core/balance.ts';
import { uuid } from '../util/uuid.ts';
import {
  GAME_STATE_VERSION,
  type AppEvent,
  type AppState,
  type BattleProgress,
  type CharactersState,
  type DailyChallengeState,
  type EquipmentState,
  type EventLog,
  type EventType,
  type GameState,
  type GhostDuelState,
  type LeagueState,
  type PartsProgress,
  type Session,
  type SetEntry,
  type UiState,
  type ViewKey,
} from './DataStore.ts';

/* ------------------------------------------------------------- constants */

export const STATE_KEY = 'gymrpg_state_v1';
export const EVENTS_KEY = 'gymrpg_events_v1';
/**
 * Per-INSTALL device id (a uuid), in its own tiny key rather than inside the
 * state or the event envelope on purpose: it must survive a `clear()`, a JSON
 * import and a `replaceAll` — all of which overwrite the other two blobs — and
 * it must never travel with an export (importing a backup on a second device
 * must not make it claim the first device's identity).
 */
export const DEVICE_KEY = 'gymrpg_device_v1';
export const LEGACY_KEY = 'hyp3_data_v1';
export const LEGACY_UI_KEY = 'hyp3_ui_v1';

/**
 * Bump when the shape of `AppState` changes, and add a step to STATE_MIGRATIONS.
 * v2 (Phase 1): the opaque `game` slot became a typed `GameState`.
 * v3 (editable plans): `plan: PlanDoc | null` joined the state. The step is a
 * pure addition — a v2 blob simply had no plan, i.e. the built-in program.
 * v4 (variable-day plans): the plan document itself went to v2 (days became an
 * ordered array with their own keys, labels and weeklyTarget).
 * The step re-routes the cached plan through `normalizePlanDoc`, which performs
 * the document migration; the rest of the state is untouched.
 * v5 (the 🍽️ nutrition tracker): `nutrition` joined the state. A pure addition —
 * a v4 blob simply has no meals. An empty cache is CORRECT here (unlike the
 * GameState ledgers): a v4 build could not create meal events locally, and any
 * that were round-tripped through the cloud replay into the cache on the very
 * next rebuild, because the log — not this blob — is the source of truth.
 * v6 (user-saved presets): `planPresets` joined the state. The same argument a
 * second time: a v5 build could not create preset events locally, an empty cache
 * costs nothing, and presets that round-tripped through the cloud fold back into
 * it on the next rebuild — the log, not this blob, is the source of truth.
 */
export const CURRENT_STATE_VERSION = 6;
/**
 * Bump when the shape of `EventLog` changes.
 * v2 (merge-safe core): events may carry an optional `device` stamp and the log
 * is folded in a `(ts, id)` total order. Both are additive, so the 1 -> 2 step
 * is an identity — it exists so a v1 log is re-persisted as v2 and future steps
 * have a version to hang off.
 */
export const CURRENT_EVENTLOG_VERSION = 2;

export const EXPORT_FORMAT = 'gym-rpg-export';

/** Minimal slice of the Web Storage API — lets tests inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/* --------------------------------------------------------------- helpers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Preserve meaning of a legacy value that may be a string or a number. */
function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * The day the app opens on. Re-exported from the plan model, which owns the
 * weekday mapping now that a plan defines its own days; for `plan === null` it
 * is the legacy mapping unchanged (Sun/Mon -> A, Tue/Wed -> B, Thu-Sat -> C).
 */
export { defaultDay };

/**
 * The fresh UI slot. The view is the default TAB, not merely the default day: a
 * plan whose days are trained on several weekdays shows one tab per weekday, and
 * the app opens on today's occurrence of the workout (see `scheduleTabs`). For
 * the built-in program the two are the same string.
 */
export function emptyUi(now: Date = new Date(), plan: PlanDoc | null = null): UiState {
  return { view: defaultTabView(plan, now), open: {} };
}

export function emptyState(now: number = Date.now()): AppState {
  return {
    schemaVersion: CURRENT_STATE_VERSION,
    sessions: {},
    ui: emptyUi(new Date(now)),
    game: null,
    plan: null,
    planPresets: {},
    nutrition: emptyNutrition(),
    meta: { legacyImported: false, createdAt: now, updatedAt: now },
  };
}

export function emptyEventLog(): EventLog {
  return { schemaVersion: CURRENT_EVENTLOG_VERSION, events: [] };
}

/**
 * Build one event. `device` is omitted entirely when unknown (never written as
 * `undefined`), so the JSON of an unstamped event is byte-identical to what
 * earlier versions produced.
 */
export function makeEvent(
  type: EventType,
  payload: Record<string, unknown> = {},
  ts: number = Date.now(),
  device?: string,
): AppEvent {
  return device ? { id: uuid(), ts, type, payload, device } : { id: uuid(), ts, type, payload };
}

/* -------------------------------------------------- shape normalisation */

export function normalizeSet(raw: unknown): SetEntry | null {
  if (!isRecord(raw)) return null;
  return { w: toStr(raw['w']), r: toStr(raw['r']), done: raw['done'] === true };
}

/**
 * A session as stored. The day key is PRESERVED verbatim whenever it is a
 * plausible key — including one this build has never seen, because a plan on
 * another device may define days this one knows nothing about. Only junk (a
 * non-string, an empty string, one of the reserved view keys) falls back to 'A',
 * which is what every pre-plan session carried anyway.
 */
export function normalizeSession(raw: unknown): Session | null {
  if (!isRecord(raw)) return null;
  const day: DayKey = isDayKey(raw['day']) ? raw['day'] : 'A';
  const ex: Record<string, (SetEntry | null)[]> = {};
  const exRaw = raw['ex'];
  if (isRecord(exRaw)) {
    for (const exId of Object.keys(exRaw)) {
      const arr = exRaw[exId];
      if (!Array.isArray(arr)) continue;
      // `map` on a JSON-parsed array keeps holes as `null` — that is exactly
      // what the legacy sparse arrays serialise to, so nothing is lost.
      ex[exId] = arr.map((s) => normalizeSet(s));
    }
  }
  return { day, ex };
}

export function normalizeSessions(raw: unknown): Record<string, Session> {
  const out: Record<string, Session> = {};
  if (!isRecord(raw)) return out;
  for (const date of Object.keys(raw)) {
    const s = normalizeSession(raw[date]);
    if (s) out[date] = s;
  }
  return out;
}

/* ------------------------------------------------------ game blob routing */

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function normalizeNumberMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const k of Object.keys(raw)) {
    const n = raw[k];
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function normalizeFlagMap(raw: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  if (!isRecord(raw)) return out;
  for (const k of Object.keys(raw)) if (raw[k] === true) out[k] = true;
  return out;
}

function normalizeParts(raw: unknown): PartsProgress {
  const parts = emptyGame().parts;
  if (!isRecord(raw)) return parts;
  for (const part of BODY_PARTS) {
    const p: BodyPart = part;
    const entry = raw[p];
    if (!isRecord(entry)) continue;
    parts[p] = { xp: Math.max(0, numOr(entry['xp'], 0)), level: Math.max(1, numOr(entry['level'], 1)) };
  }
  return parts;
}

/** Phase 2/3 battle progress. Anything odd falls back to "world 1, wave 1". */
function normalizeBattle(raw: unknown): BattleProgress {
  const b = emptyBattle();
  if (!isRecord(raw)) return b;
  const bosses = Array.isArray(raw['bossesDefeated'])
    ? raw['bossesDefeated'].filter((id): id is string => typeof id === 'string' && bossById(id) !== undefined)
    : [];
  const bossesDefeated = [...new Set(bosses)];
  // The world/wave markers are DERIVED from the trophy shelf, exactly as they
  // are at the end of a fold (`finalizeBattleProgress`). Doing it here too is
  // what lets an existing, still-valid v10 blob pick up the nine-world unlock
  // without a version bump: the shape did not change, only what the same shape
  // means once world 4 stopped being the last world.
  const at = derivedProgress({
    world: Math.max(1, Math.floor(numOr(raw['world'], b.world))),
    wave: Math.max(1, Math.floor(numOr(raw['wave'], b.wave))),
    bossesDefeated,
  });
  return {
    world: at.world,
    wave: at.wave,
    coins: Math.max(0, numOr(raw['coins'], 0)),
    wavesCleared: Math.max(0, Math.floor(numOr(raw['wavesCleared'], 0))),
    miniBossesCleared: Math.max(0, Math.floor(numOr(raw['miniBossesCleared'], 0))),
    bossesDefeated,
    overtime: normalizeOvertime(raw['overtime']),
  };
}

/** `battle.overtime` — a world-id → count record; anything odd is dropped. */
function normalizeOvertime(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const world = Math.floor(Number(key));
    const n = Math.floor(numOr(value, 0));
    if (Number.isFinite(world) && world >= 1 && n > 0) out[String(world)] = n;
  }
  return out;
}

/**
 * Phase 3 wardrobe. Unknown item ids are dropped (the roster is code, the save
 * is data — a removed item must not resurrect as a phantom bonus), and a slot
 * can only hold an item that is both known and owned.
 */
function normalizeEquipment(raw: unknown): EquipmentState {
  const out = emptyEquipment();
  if (!isRecord(raw)) return out;
  const owned = Array.isArray(raw['owned'])
    ? raw['owned'].filter((id): id is string => typeof id === 'string' && equipmentById(id) !== undefined)
    : [];
  out.owned = [...new Set(owned)];

  const eq = raw['equipped'];
  if (isRecord(eq)) {
    for (const slot of EQUIPMENT_SLOTS) {
      const id = eq[slot];
      if (typeof id !== 'string') continue;
      const def = equipmentById(id);
      if (def && def.slot === slot && out.owned.includes(id)) out.equipped[slot] = id;
    }
  }

  // Upgrade levels (v7). Same rule again: a level on an id the roster no longer
  // has is dropped, and anything outside 1…max is clamped — a hand-edited blob
  // can neither invent a +9 nor keep paying a bonus for an item that is gone.
  // Ownership is deliberately NOT required here: the reducer does not require it
  // either, so the blob and a replay of the log always agree.
  const up = raw['upgrades'];
  if (isRecord(up)) {
    for (const id of Object.keys(up).sort()) {
      if (!equipmentById(id)) continue;
      const level = clampUpgradeLevel(numOr(up[id], 0));
      if (level > 0) out.upgrades[id] = level;
    }
  }
  return out;
}

/**
 * The roster (body × skin). Same rule as the wardrobe: unknown ids are dropped
 * (the roster is code, the save is data), the free skin is never stored as
 * "owned" because it always is, and a `selected` the save cannot actually play
 * falls back to the default hero rather than rendering nothing.
 *
 * Both id shapes are tolerated on the way in — `owned` entries are reduced to
 * their SKIN (`'robot_f'` → `'robot'`) and `selected` is resolved to a
 * combination (`'robot'` → `'robot_m'`) — so a blob hand-edited, restored from
 * an old export, or written by another build still lands somewhere playable.
 */
function normalizeCharacters(raw: unknown): CharactersState {
  const out = emptyCharacters();
  if (!isRecord(raw)) return out;
  const owned = Array.isArray(raw['owned'])
    ? raw['owned']
        .map((id) => (typeof id === 'string' ? skinOf(id) : undefined))
        .filter((skin): skin is SkinDef => skin !== undefined && skin.cost > 0)
        .map((skin) => skin.id)
    : [];
  out.owned = [...new Set(owned)];

  const selected = typeof raw['selected'] === 'string' ? resolveCharacterId(raw['selected']) : undefined;
  const def = selected === undefined ? undefined : characterById(selected);
  if (def && (def.cost === 0 || out.owned.includes(def.skin))) out.selected = def.id;
  return out;
}

/**
 * The daily-challenge ledger (v8).
 *
 * Only `runs` is read: everything else in `DailyChallengeState` is DERIVED and
 * is recomputed by `finalizeGame` right after this, so a hand-edited blob cannot
 * claim a best score or a streak its ledger does not support. Each entry is
 * clamped to the shape the reducer writes; a key that is not a date is dropped,
 * because the date IS the idempotency key and a junk key would sit in the ledger
 * for ever, silently consuming an attempt that was never made.
 */
function normalizeDaily(raw: unknown): DailyChallengeState {
  const out = emptyDaily();
  if (!isRecord(raw)) return out;
  const runs = raw['runs'];
  if (!isRecord(runs)) return out;
  const maxScore = BALANCE.daily.waves;
  for (const date of Object.keys(runs).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const run = runs[date];
    if (!isRecord(run)) continue;
    out.runs[date] = {
      score: Math.min(maxScore, Math.max(0, Math.floor(numOr(run['score'], 0)))),
      tiebreak: Math.min(100, Math.max(0, numOr(run['tiebreak'], 0))),
      coins: Math.max(0, numOr(run['coins'], 0)),
      complete: run['complete'] === true,
    };
  }
  return out;
}

/**
 * Same treatment for the duel ledger: only well-formed entries survive, and
 * every total is left at zero because `finalizeGame` DERIVES them from the
 * entries. A hand-edited blob can therefore claim a hundred wins and be ignored.
 *
 * The key has to be `"<date>|<handle>"` and the handle inside the entry has to
 * agree with it, or the row is dropped — a mismatched pair would otherwise let
 * a blob park a duel in a slot that the reducer would never have chosen, and
 * the ledger's whole idempotency rests on that key meaning exactly one thing.
 */
function normalizeDuels(raw: unknown): GhostDuelState {
  const out = emptyDuels();
  if (!isRecord(raw)) return out;
  const runs = raw['runs'];
  if (!isRecord(runs)) return out;
  for (const key of Object.keys(runs).sort()) {
    const run = runs[key];
    if (!isRecord(run)) continue;
    const [date, handleFromKey] = key.split('|');
    if (!date || !handleFromKey || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const opponent = normalizeHandle(run['opponent']);
    if (!opponent || opponent !== normalizeHandle(handleFromKey)) continue;
    const won = run['won'] === true;
    out.runs[duelKey(date, opponent)] = {
      opponent,
      won,
      score: won ? 1 : 0,
      tiebreak: Math.min(100, Math.max(0, numOr(run['tiebreak'], 0))),
    };
  }
  return out;
}

/**
 * הליגה's ledgers (v11).
 *
 * Only the four FOLDED maps are read — `coins`, `coinsEarned`, `coinsSpent` and
 * `months` are DERIVED and are recomputed by `finalizeGame` right after this, so
 * a hand-edited blob cannot claim a purse its ledgers do not support. Every key
 * is validated the way the reducer validates it (a week key must be a real
 * SUNDAY, a month key a real `'YYYY-MM'`), because those keys ARE the
 * idempotency units: a junk key would sit in the ledger for ever, silently
 * consuming a week that was never graded or an item that was never redeemed.
 */
function normalizeLeague(raw: unknown): LeagueState {
  const out = emptyLeague();
  if (!isRecord(raw)) return out;
  const B = BALANCE.league;
  const unit = (v: unknown): number => Math.min(1, Math.max(0, numOr(v, 0)));

  const weeks = raw['weeks'];
  if (isRecord(weeks)) {
    for (const weekKey of Object.keys(weeks).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey) || weekStartISO(weekKey) !== weekKey) continue;
      const week = weeks[weekKey];
      if (!isRecord(week)) continue;
      out.weeks[weekKey] = {
        score: Math.min(100, Math.max(0, numOr(week['score'], 0))),
        c: unit(week['c']),
        q: unit(week['q']),
        l: unit(week['l']),
        p: unit(week['p']),
        coin: week['coin'] === true,
        volume: Math.max(0, numOr(week['volume'], 0)),
        days: Math.max(0, Math.floor(numOr(week['days'], 0))),
        prs: Math.max(0, Math.floor(numOr(week['prs'], 0))),
      };
    }
  }

  const redemptions = raw['redemptions'];
  if (isRecord(redemptions)) {
    for (const key of Object.keys(redemptions).sort()) {
      const entry = redemptions[key];
      if (!isRecord(entry)) continue;
      const [month, itemFromKey] = key.split('|');
      const itemId = typeof entry['itemId'] === 'string' ? entry['itemId'] : '';
      // The id inside the row has to agree with the key it is filed under, or
      // the row could park a redemption in a slot the reducer never chose.
      if (!month || !isLeagueMonthKey(month) || !itemId || itemId !== itemFromKey) continue;
      const kind = entry['kind'];
      out.redemptions[key] = {
        itemId,
        kind: kind === 'gift' || kind === 'experience' || kind === 'challenge' ? kind : 'gift',
        cost: Math.min(B.maxCost, Math.max(0, numOr(entry['cost'], 0))),
      };
    }
  }

  const challenges = raw['challenges'];
  if (isRecord(challenges)) {
    for (const month of Object.keys(challenges).sort()) {
      if (!isLeagueMonthKey(month)) continue;
      const entry = challenges[month];
      if (!isRecord(entry)) continue;
      const challengeId = typeof entry['challengeId'] === 'string' ? entry['challengeId'] : '';
      if (!challengeId) continue;
      out.challenges[month] = {
        challengeId,
        cost: Math.min(B.maxCost, Math.max(0, numOr(entry['cost'], 0))),
      };
    }
  }

  const completions = raw['completions'];
  if (isRecord(completions)) {
    for (const key of Object.keys(completions).sort()) {
      const [month, challengeId] = key.split('|');
      if (!month || !isLeagueMonthKey(month) || !challengeId) continue;
      out.completions[key] = Math.min(B.maxBonus, Math.max(0, numOr(completions[key], 0)));
    }
  }

  return out;
}

/** `'YYYY-MM'` with a month between 01 and 12 — the league's month key. */
function isLeagueMonthKey(v: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(v)) return false;
  const m = Number(v.slice(5, 7));
  return m >= 1 && m <= 12;
}

/**
 * Validate a persisted `game` blob. Returns `null` for anything missing or from
 * a version we don't know — the caller (`ensureGameState`) then rebuilds it from
 * the event log, which is always authoritative.
 *
 * v1 -> v2 (Phase 2) added `battle`; v2 -> v3 (Phase 3) added
 * `battle.bossesDefeated` and `equipment`; v3 -> v4 added the merge-idempotency
 * ledgers `energyGranted` + `prKeys`, which cannot be inferred from an old blob
 * (it only knows the totals, not which grants produced them); v4 -> v5 added
 * `characters` (the roster), which an old blob simply does not have; v5 -> v6
 * turned that roster into a body × skin matrix, where `characters.owned` means
 * SKINS and `characters.selected` means a combination — the same field names
 * carrying different ids, which is precisely the case a version number exists
 * for; v6 -> v7 (equipment upgrades) added `equipment.upgrades`, the per-item
 * +0…+3 level — a field a v6 blob simply does not have, and defaulting it to
 * `{}` would silently ERASE levels that are sitting in the log; v7 -> v8 (the
 * daily challenge) added `daily.runs`, the per-date ledger of attempts, where an
 * empty default would be worse than wrong: it would say "you never played", and
 * hand back an attempt the log already recorded as spent. An older blob is
 * therefore rejected here and rebuilt from the log, which is lossless because
 * every fact is an event. That rebuild IS the sanctioned migration path. v8 ->
 * v9 (ghost duels) added `duels.runs`, the per-(date, opponent) ledger, for the
 * third time the same reason: an empty default would hand back a duel the log
 * already spent. v9 -> v10 (dev mode) added `devUsed` + `devKeys` + `devCycles`,
 * for the fourth: an empty default would say "this account never used a dev
 * grant" — dropping the 🛠 flag off the published ghost — and would hand back a
 * daily/duel reset cycle the log already opened. v10 -> v11 (הליגה) added
 * `league`, whose `weeks` map is the ledger that decides which weeks have been
 * graded; a fifth time, an empty default would be worse than wrong — it would
 * say "no week was ever closed", letting the lazy close re-close every week in
 * the backfill window and re-mint its 🔵. Rejected and replayed instead.
 * v11 -> v12 (the league's best-grade ledger) adds NO FIELD: it changes what a
 * fold of the same events MEANS — `league.weeks[week]` is now the best-scoring
 * close of that week rather than the first one — and a cached fold under the old
 * rule can disagree with a replay of its own log without anything being able to
 * tell. Rejected for that reason alone (see `GAME_STATE_VERSION`).
 */
export function normalizeGame(raw: unknown): GameState | null {
  if (!isRecord(raw)) return null;
  if (numOr(raw['version'], 0) !== GAME_STATE_VERSION) return null;

  const base = emptyGame();
  const streakRaw = isRecord(raw['streak']) ? raw['streak'] : {};
  const days = Array.isArray(raw['workoutDays'])
    ? raw['workoutDays'].filter((d): d is string => typeof d === 'string')
    : [];
  return {
    version: GAME_STATE_VERSION,
    parts: normalizeParts(raw['parts']),
    level: Math.max(1, numOr(raw['level'], 1)),
    totalXp: Math.max(0, numOr(raw['totalXp'], 0)),
    energy: Math.max(0, numOr(raw['energy'], 0)),
    energyEarned: Math.max(0, numOr(raw['energyEarned'], 0)),
    prCount: Math.max(0, numOr(raw['prCount'], 0)),
    best: normalizeNumberMap(raw['best']),
    granted: normalizeFlagMap(raw['granted']),
    bonusDays: normalizeFlagMap(raw['bonusDays']),
    energyGranted: normalizeFlagMap(raw['energyGranted']),
    prKeys: normalizeFlagMap(raw['prKeys']),
    workoutDays: [...new Set(days)].sort(),
    streak: {
      tier: Math.max(0, numOr(streakRaw['tier'], 0)),
      weekStart: typeof streakRaw['weekStart'] === 'string' ? streakRaw['weekStart'] : null,
      daysThisWeek: Math.max(0, numOr(streakRaw['daysThisWeek'], 0)),
      needed: Math.max(1, numOr(streakRaw['needed'], base.streak.needed)),
    },
    battle: normalizeBattle(raw['battle']),
    equipment: normalizeEquipment(raw['equipment']),
    characters: normalizeCharacters(raw['characters']),
    daily: normalizeDaily(raw['daily']),
    duels: normalizeDuels(raw['duels']),
    league: normalizeLeague(raw['league']),
    devUsed: raw['devUsed'] === true,
    devKeys: normalizeFlagMap(raw['devKeys']),
    devCycles: normalizeCycleMap(raw['devCycles']),
  };
}

/** Dev reset cycles: whole numbers ≥ 1 only — a cycle is a high-water mark. */
function normalizeCycleMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const key of Object.keys(raw).sort()) {
    const n = Math.floor(numOr(raw[key], 0));
    if (n >= 1) out[key] = n;
  }
  return out;
}

/**
 * The persisted UI slot. A view that is one of the four reserved screens is kept
 * as-is; a DAY view is kept only when the active plan still answers to it
 * (otherwise the app would open on a tab that does not exist), and anything else
 * falls back to the plan's default tab for `now`.
 *
 * "Answers to it" is `isTabView`, so BOTH shapes a view has ever had are still
 * accepted verbatim: a bare day key (`'A'`, `'d_alef'` — everything written
 * before schedule-expanded tabs) and an occurrence id (`'d_alef@3'`). A bare key
 * is not rewritten here: the shell canonicalises it to the tab it renders, so
 * nothing about the stored blob has to move for this feature.
 */
function normalizeUi(raw: unknown, now: Date = new Date(), plan: PlanDoc | null = null): UiState {
  if (!isRecord(raw)) return emptyUi(now, plan);
  const view = raw['view'];
  const open: Record<string, boolean> = {};
  const openRaw = raw['open'];
  if (isRecord(openRaw)) {
    for (const k of Object.keys(openRaw)) open[k] = openRaw[k] === true;
  }
  const known = isTabView(resolveProgram(plan), view);
  const v: ViewKey = isReservedViewKey(view) || known ? (view as ViewKey) : defaultTabView(plan, now);
  return { view: v, open };
}

/* ---------------------------------------------------------- state routing */

/**
 * Ordered upgrade steps. `STATE_MIGRATIONS[n]` upgrades a blob from version `n`
 * to version `n + 1`. Version 0 = "unversioned / unknown legacy-ish blob".
 */
const STATE_MIGRATIONS: ReadonlyArray<(blob: Record<string, unknown>) => Record<string, unknown>> = [
  // 0 -> 1: adopt the AppState envelope (sessions/ui/game/meta).
  (blob) => ({
    sessions: blob['sessions'] ?? {},
    ui: blob['ui'] ?? null,
    game: blob['game'] ?? null,
    meta: blob['meta'] ?? null,
    schemaVersion: 1,
  }),
  // 1 -> 2: the `game` slot is typed from Phase 1 on. A v1 blob can only ever
  // have carried `null` there (Phase 0 never wrote game state), so anything
  // else is dropped and `ensureGameState` rebuilds it from the event log.
  (blob) => ({ ...blob, game: normalizeGame(blob['game']), schemaVersion: 2 }),
  // 2 -> 3: editable plans. A v2 blob predates the plan editor, so it can only
  // mean "the built-in program" — but the slot is routed through
  // `normalizePlanDoc` anyway, so a blob that somehow carries one is validated
  // rather than trusted.
  (blob) => ({ ...blob, plan: normalizePlanDoc(blob['plan']), schemaVersion: 3 }),
  // 3 -> 4: variable-day plans. A v3 blob caches a PlanDoc v1 (the fixed A/B/C
  // record); `normalizePlanDoc` migrates it to v2 in place. Nothing else moves,
  // and the log — which is the source of truth — needs no rewriting at all,
  // because `plan_updated` payloads are normalised on every fold.
  (blob) => ({ ...blob, plan: normalizePlanDoc(blob['plan']), schemaVersion: 4 }),
  // 4 -> 5: the nutrition tracker. A v4 blob has no meals; the slot is routed
  // through `normalizeNutrition` anyway, so a blob that somehow carries one is
  // validated rather than trusted (same argument as the plan slot above).
  (blob) => ({ ...blob, nutrition: normalizeNutrition(blob['nutrition']), schemaVersion: 5 }),
  // 5 -> 6: user-saved presets. A v5 blob has none; the slot is routed through
  // `normalizeUserPresets` anyway, so a blob that somehow carries one is
  // validated rather than trusted (same argument as nutrition above).
  (blob) => ({ ...blob, planPresets: normalizeUserPresets(blob['planPresets']), schemaVersion: 6 }),
  // 6 -> 7: (future) add your step here and bump CURRENT_STATE_VERSION.
];

function readVersion(blob: Record<string, unknown>): number {
  const v = blob['schemaVersion'];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Route ANY persisted state blob (any version, or garbage) to a valid current
 * `AppState`. Never throws.
 */
export function migrateState(raw: unknown, now: number = Date.now()): AppState {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return emptyState(now);
    }
  }
  if (!isRecord(raw)) return emptyState(now);

  let blob: Record<string, unknown> = raw;
  let version = readVersion(blob);
  if (version > CURRENT_STATE_VERSION) {
    // Blob written by a newer build: keep the data we understand, don't crash.
    version = CURRENT_STATE_VERSION;
  }
  while (version < CURRENT_STATE_VERSION) {
    const step = STATE_MIGRATIONS[version];
    if (!step) break;
    blob = step(blob);
    version += 1;
  }

  const metaRaw = isRecord(blob['meta']) ? blob['meta'] : {};
  const createdAt = typeof metaRaw['createdAt'] === 'number' ? metaRaw['createdAt'] : now;
  // The plan is read FIRST: it decides which day views are legal and what the
  // default tab is, so the UI slot cannot be validated without it.
  const plan = normalizePlanDoc(blob['plan']);
  const state: AppState = {
    schemaVersion: CURRENT_STATE_VERSION,
    sessions: normalizeSessions(blob['sessions']),
    ui: normalizeUi(blob['ui'], new Date(now), plan),
    game: normalizeGame(blob['game']),
    plan,
    planPresets: normalizeUserPresets(blob['planPresets']),
    nutrition: normalizeNutrition(blob['nutrition']),
    meta: {
      legacyImported: metaRaw['legacyImported'] === true,
      createdAt,
      updatedAt: typeof metaRaw['updatedAt'] === 'number' ? metaRaw['updatedAt'] : now,
    },
  };
  if (typeof metaRaw['legacyImportedAt'] === 'number') {
    state.meta.legacyImportedAt = metaRaw['legacyImportedAt'];
  }
  return state;
}

/* ------------------------------------------------------ event log routing */

const EVENTLOG_MIGRATIONS: ReadonlyArray<(blob: Record<string, unknown>) => Record<string, unknown>> = [
  // 0 -> 1: adopt the {schemaVersion, events} envelope.
  (blob) => ({ events: blob['events'] ?? [], schemaVersion: 1 }),
  // 1 -> 2: `device` + the (ts, id) total order. Purely additive — an existing
  // event needs no rewriting, it simply has no device stamp.
  (blob) => ({ ...blob, schemaVersion: 2 }),
];

export function normalizeEvent(raw: unknown): AppEvent | null {
  if (!isRecord(raw)) return null;
  const type = raw['type'];
  if (typeof type !== 'string') return null;
  const ts = typeof raw['ts'] === 'number' && Number.isFinite(raw['ts']) ? raw['ts'] : 0;
  const id = typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : uuid();
  const payload = isRecord(raw['payload']) ? raw['payload'] : {};
  const device = raw['device'];
  return typeof device === 'string' && device
    ? { id, ts, type: type as EventType, payload, device }
    : { id, ts, type: type as EventType, payload };
}

export function migrateEventLog(raw: unknown): EventLog {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return emptyEventLog();
    }
  }
  let blob: Record<string, unknown>;
  if (Array.isArray(raw)) blob = { events: raw, schemaVersion: 0 };
  else if (isRecord(raw)) blob = raw;
  else return emptyEventLog();

  let version = readVersion(blob);
  if (version > CURRENT_EVENTLOG_VERSION) version = CURRENT_EVENTLOG_VERSION;
  while (version < CURRENT_EVENTLOG_VERSION) {
    const step = EVENTLOG_MIGRATIONS[version];
    if (!step) break;
    blob = step(blob);
    version += 1;
  }

  const list = Array.isArray(blob['events']) ? blob['events'] : [];
  const events: AppEvent[] = [];
  for (const e of list) {
    const ev = normalizeEvent(e);
    if (ev) events.push(ev);
  }
  return { schemaVersion: CURRENT_EVENTLOG_VERSION, events };
}

/* ------------------------------------------------------------ legacy import */

/** Deterministic ts for an imported historical session: that date at 00:00 UTC. */
function tsForDate(date: string): number {
  return isoToTs(date);
}

export interface LegacyImportResult {
  state: AppState;
  events: AppEvent[];
  imported: boolean;
  sessionCount: number;
}

/**
 * Merge a legacy `hyp3_data_v1` blob (and optional `hyp3_ui_v1`) into `state`.
 *
 * Existing dates in `state` win (we never clobber newer data). Emits one
 * `legacy_import` summary event plus one `session_imported` event per date,
 * timestamped at the workout's own date so Phase 1 can compute retroactive XP
 * and streaks in chronological order.
 */
export function importLegacy(
  state: AppState,
  legacyRaw: unknown,
  legacyUiRaw: unknown = null,
  now: number = Date.now(),
): LegacyImportResult {
  if (typeof legacyRaw === 'string') {
    try {
      legacyRaw = JSON.parse(legacyRaw) as unknown;
    } catch {
      return { state, events: [], imported: false, sessionCount: 0 };
    }
  }
  if (!isRecord(legacyRaw) || !isRecord(legacyRaw['sessions'])) {
    return { state, events: [], imported: false, sessionCount: 0 };
  }

  const legacySessions = normalizeSessions(legacyRaw['sessions']);
  const dates = Object.keys(legacySessions).sort();
  const events: AppEvent[] = [];
  const sessions: Record<string, Session> = { ...state.sessions };

  for (const date of dates) {
    const s = legacySessions[date];
    if (!s) continue;
    if (!sessions[date]) sessions[date] = s;
    events.push(
      makeEvent(
        'session_imported',
        { date, day: s.day, ex: s.ex, source: 'legacy_v1', importedAt: now },
        tsForDate(date),
      ),
    );
  }

  events.push(
    makeEvent('legacy_import', { key: LEGACY_KEY, sessionCount: dates.length, dates }, now),
  );

  const ui = isRecord(legacyUiRaw) || typeof legacyUiRaw === 'string'
    ? normalizeUi(
        typeof legacyUiRaw === 'string' ? safeParse(legacyUiRaw) : legacyUiRaw,
        new Date(now),
        state.plan,
      )
    : state.ui;

  const nextState: AppState = {
    ...state,
    sessions,
    ui,
    meta: { ...state.meta, legacyImported: true, legacyImportedAt: now, updatedAt: now },
  };
  return { state: nextState, events, imported: true, sessionCount: dates.length };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/* -------------------------------------------------- game state hydration */

export interface EnsureGameResult {
  state: AppState;
  events: AppEvent[];
  /** True when the game blob and/or the log had to be written back. */
  changed: boolean;
}

function materialize(pending: readonly PendingEvent[]): AppEvent[] {
  return pending.map((p) => makeEvent(p.type, p.payload, p.ts));
}

/**
 * Guarantee `state.game` exists and matches the current version.
 *
 * This is the RETROACTIVE-XP entry point and it covers three cases at once:
 *  1. a legacy `hyp3_data_v1` import that just happened (session_imported events);
 *  2. a user who already imported under PHASE 0 (`meta.legacyImported === true`,
 *     `game === null`) — their sessions are in state and, if the log somehow
 *     lacks them, `session_imported` events are recovered from state first;
 *  3. workouts logged live under Phase 0, which produced set events but no XP.
 *
 * All of it is expressed as EVENTS (`buildRetroactiveGrants`) appended to the
 * log, so the rebuilt game state stays a pure function of the log forever after.
 * Running it twice is a no-op: every grant is guarded per (date, exercise, set).
 *
 * AND A FOURTH, ON EVERY SINGLE BOOT: a blob that is already at the current
 * version is REHYDRATED, not replayed — but `normalizeGame` deliberately hands
 * back every DERIVED field at zero (see `normalizeLeague` / `normalizeDuels`:
 * a hand-edited blob may not claim a purse or a win record its ledgers do not
 * support). Something has to derive them again, and until this call existed
 * nothing did on the quiet path: a boot that folded no event left 🔵 0 and an
 * empty league history sitting beside a ledger full of closed, coin-minting
 * weeks — the screen contradicting itself, exactly as reported. It is a pure
 * function of the ledgers, so it is cheap, idempotent, and NOT a change worth
 * writing back (`changed` stays false; the next real write persists it).
 */
export function ensureGameState(
  state: AppState,
  events: readonly AppEvent[],
  now: number = Date.now(),
): EnsureGameResult {
  if (state.game && state.game.version === GAME_STATE_VERSION) {
    finalizeDerived(state.game, todayISO(new Date(now)));
    return { state, events: [...events], changed: false };
  }

  const today = todayISO(new Date(now));
  let log: AppEvent[] = [...events];

  // (2) sessions that the log knows nothing about — recover them as events so
  // the log alone can rebuild everything from here on.
  const covered = new Set<string>();
  for (const ev of log) {
    const d = ev.payload['date'];
    if (typeof d === 'string' && (ev.type === 'session_imported' || ev.type.startsWith('set_'))) {
      covered.add(d);
    }
  }
  const recovered = Object.keys(state.sessions)
    .filter((d) => !covered.has(d))
    .sort()
    .map((date) => {
      const s = state.sessions[date] as Session;
      return makeEvent(
        'session_imported',
        { date, day: s.day, ex: s.ex, source: 'recovered', importedAt: now },
        tsForDate(date),
      );
    });
  if (recovered.length > 0) log = [...log, ...recovered];

  // The PLAN has to be folded BEFORE the grants are built: a set of a custom
  // exercise can only be mapped to the right body parts by a resolver that
  // knows that exercise, and the plan lives in the log exactly like everything
  // else. The log is authoritative here, so the folded plan also replaces
  // whatever the (stale) state blob claimed.
  const plan = planFromEvents(log);
  const grants = materialize(
    buildRetroactiveGrants(state.sessions, log, today, {
      resolve: makeResolver(plan),
      program: resolveProgram(plan),
    }),
  );
  if (grants.length > 0) log = [...log, ...grants];

  const game = rebuildGame(log, today);
  return {
    state: { ...state, game, plan, meta: { ...state.meta, updatedAt: now } },
    events: log,
    changed: true,
  };
}

/* --------------------------------------------------------------- device id */

/**
 * Read this install's device id, minting + persisting one on first use.
 *
 * It identifies the INSTALL, never the user: it is not part of the state, not
 * part of an export, and survives `clear()`. Its only jobs are stamping
 * `AppEvent.device` and telling `LocalStore` which events are its own for the
 * monotonic-clock clamp.
 */
export function ensureDeviceId(storage: StorageLike): string {
  try {
    const existing = storage.getItem(DEVICE_KEY);
    if (typeof existing === 'string' && existing.length > 0) return existing;
  } catch {
    /* storage unavailable — fall through to an in-memory id for this session */
  }
  const id = uuid();
  try {
    storage.setItem(DEVICE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

/* ------------------------------------------------------------- bootstrap */

export interface BootstrapResult {
  state: AppState;
  events: AppEvent[];
  /** True when something was written back (fresh install or legacy import). */
  dirty: boolean;
}

/**
 * First read on app start: load + migrate both blobs, and, if this device still
 * has legacy `hyp3_data_v1` data that was never imported, import it losslessly.
 * The legacy keys are intentionally NOT deleted (cheap safety net).
 */
export function bootstrap(storage: StorageLike, now: number = Date.now()): BootstrapResult {
  const rawState = storage.getItem(STATE_KEY);
  const rawEvents = storage.getItem(EVENTS_KEY);
  const hadState = rawState !== null;

  let state = migrateState(rawState, now);
  const log = migrateEventLog(rawEvents);
  let events = log.events;
  let dirty = !hadState;

  if (!state.meta.legacyImported) {
    const legacy = storage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      const res = importLegacy(state, legacy, storage.getItem(LEGACY_UI_KEY), now);
      if (res.imported) {
        state = res.state;
        events = [...events, ...res.events];
        dirty = true;
      }
    } else if (!hadState) {
      // Nothing to import — remember that so we don't re-scan every boot.
      state = { ...state, meta: { ...state.meta, legacyImported: true } };
    }
  }

  // Phase 1: hydrate (and, on the first Phase 1 load, retroactively grant) the
  // game layer. No-op once `state.game` is at the current version.
  const ensured = ensureGameState(state, events, now);
  state = ensured.state;
  events = ensured.events;
  dirty = dirty || ensured.changed;

  return { state, events, dirty };
}

/* ----------------------------------------------------------- export/import */

export interface ExportBlob extends Record<string, unknown> {
  format: string;
  schemaVersion: number;
  exportedAt: number;
  state: AppState;
  events: AppEvent[];
  /** Back-compat mirror so the legacy app can still read our exports. */
  sessions: Record<string, Session>;
}

/**
 * Build the export payload. It carries the full state (including the `game`
 * slot that Phase 1+ fills) AND the event log, plus a top-level `sessions`
 * mirror for backwards compatibility with the legacy app's importer.
 */
export function buildExport(state: AppState, events: readonly AppEvent[], now: number = Date.now()): ExportBlob {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: CURRENT_STATE_VERSION,
    exportedAt: now,
    state,
    events: [...events],
    sessions: state.sessions,
  };
}

export interface ParsedImport {
  state: AppState;
  events: AppEvent[];
  /** Which on-disk shape the file used. */
  source: 'gym-rpg' | 'legacy';
}

/**
 * Parse an imported JSON file. Accepts BOTH:
 *   - the new export blob (`{format, state, events, …}`), and
 *   - the legacy backup shape (`{sessions: {...}}`).
 * Returns `null` for anything unrecognisable (caller shows a toast).
 */
export function parseImport(raw: unknown, now: number = Date.now()): ParsedImport | null {
  if (typeof raw === 'string') raw = safeParse(raw);
  if (!isRecord(raw)) return null;

  // New format first — it also contains `sessions`, so order matters.
  if (raw['format'] === EXPORT_FORMAT || isRecord(raw['state'])) {
    const state = migrateState(raw['state'] ?? raw, now);
    const events = migrateEventLog(raw['events'] ?? []).events;
    // A file exported by Phase 0 carries no game state — grant it retroactively.
    const ensured = ensureGameState(state, events, now);
    return { state: ensured.state, events: ensured.events, source: 'gym-rpg' };
  }

  if (isRecord(raw['sessions'])) {
    const base = emptyState(now);
    const res = importLegacy(base, raw, null, now);
    if (!res.imported) return null;
    const events = res.events.map((e) =>
      e.type === 'session_imported' ? { ...e, payload: { ...e.payload, source: 'json_import' } } : e,
    );
    const ensured = ensureGameState(res.state, events, now);
    return { state: ensured.state, events: ensured.events, source: 'legacy' };
  }

  return null;
}

/* ------------------------------------------------------- event replay */

/**
 * Deterministically rebuild state from the append-only log.
 *
 * Sessions are folded from the workout/data events here; the whole game layer is
 * folded by `rebuildGame()` (core/xp.ts) over the SAME log with the SAME reducer
 * the live app uses — which is what makes replay provably equivalent to live
 * state. Phase 2+ only has to extend the reducer, not this function.
 *
 * The order is `(ts, id)` (see `compareEvents`), i.e. a function of the event
 * SET alone: merging two devices' logs in either direction folds identically.
 */
export function rebuildFromEvents(events: readonly AppEvent[], now: number = Date.now()): AppState {
  const state = emptyState(now);
  const ordered = [...events].sort(compareEvents);

  for (const ev of ordered) {
    const p = ev.payload;
    switch (ev.type) {
      case 'session_imported': {
        const date = typeof p['date'] === 'string' ? p['date'] : null;
        if (!date) break;
        const session = normalizeSession({ day: p['day'], ex: p['ex'] });
        if (session && !state.sessions[date]) state.sessions[date] = session;
        state.meta.legacyImported = true;
        break;
      }
      case 'legacy_import':
        state.meta.legacyImported = true;
        state.meta.legacyImportedAt = ev.ts;
        break;
      case 'set_logged':
      case 'set_completed':
      case 'set_uncompleted': {
        const date = typeof p['date'] === 'string' ? p['date'] : null;
        const exId = typeof p['exId'] === 'string' ? p['exId'] : null;
        const idx = typeof p['setIndex'] === 'number' ? p['setIndex'] : -1;
        if (!date || !exId || idx < 0) break;
        // Any plausible day key is kept verbatim — including a key minted by a
        // plan on another device, which this build has never heard of.
        const day: DayKey = isDayKey(p['day']) ? p['day'] : 'A';
        const session = (state.sessions[date] ??= { day, ex: {} });
        session.day = day;
        const arr = (session.ex[exId] ??= []);
        while (arr.length <= idx) arr.push(null);
        const cur = arr[idx] ?? { w: '', r: '', done: false };
        arr[idx] = {
          w: typeof p['w'] === 'string' ? p['w'] : cur.w,
          r: typeof p['r'] === 'string' ? p['r'] : cur.r,
          done: ev.type === 'set_completed' ? true : ev.type === 'set_uncompleted' ? false : cur.done,
        };
        break;
      }
      case 'data_cleared':
        state.sessions = {};
        // A wipe returns the app to the built-in program too, exactly like a
        // fresh install: the plan is data, and this event erases data — and so
        // are the meal tracker and the user's saved presets.
        state.plan = null;
        state.planPresets = {};
        state.nutrition = emptyNutrition();
        break;
      /**
       * The training plan is LAST-WRITER-WINS: the whole document travels in
       * the payload, and because `ordered` is the `(ts, id)` total order, the
       * last save in that order is simply the one still standing when the loop
       * ends. Two devices holding the same events always agree on it.
       */
      case 'plan_updated':
        state.plan = normalizePlanDoc(p['plan']);
        break;
      // The user's saved presets — one shared fold for live path and replay
      // (see core/plan.ts): LWW upsert per preset id, delete removes it. The
      // `(ts, id)` order of `ordered` is what makes both merge orders converge.
      case 'plan_preset_saved':
      case 'plan_preset_deleted':
        applyPlanPresetEvent(state.planPresets, ev.type, p);
        break;
      // The 🍽️ meal tracker — one shared fold for live path and replay (see
      // core/nutrition.ts): per-id idempotent meals, tombstone deletes, LWW
      // targets. All order-free, so a union merge folds identically both ways.
      case 'meal_logged':
      case 'meal_deleted':
      case 'nutrition_targets_set':
        applyNutritionEvent(state.nutrition, ev.type, p);
        break;
      /**
       * A JSON import carries a snapshot of the sessions it brought in. Folding
       * it MERGES per date, first-wins, instead of replacing the map: on a
       * single device the already-folded dates are a subset of the snapshot, so
       * the outcome is unchanged — but in a merged multi-device log an import on
       * device A can no longer erase a workout device B logged before it.
       */
      case 'data_imported': {
        const sessions = p['sessions'];
        if (!isRecord(sessions)) break;
        const incoming = normalizeSessions(sessions);
        for (const date of Object.keys(incoming)) {
          const session = incoming[date];
          if (session && !state.sessions[date]) state.sessions[date] = session;
        }
        break;
      }
      // xp_gained / energy_gained / pr_achieved / level_up / streak_changed are
      // folded by `rebuildGame` below; battle events arrive in Phase 2.
      default:
        break;
    }
  }

  state.game = rebuildGame(ordered, todayISO(new Date(now)));
  state.meta.updatedAt = ordered.length > 0 ? (ordered[ordered.length - 1]?.ts ?? now) : now;
  return state;
}
