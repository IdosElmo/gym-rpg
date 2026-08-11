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

import { BODY_PARTS, isDayKey, type BodyPart, type DayKey } from '../data/program.ts';
import { EQUIPMENT_SLOTS, bossById, equipmentById } from '../data/gameContent.ts';
import { makeResolver, normalizePlanDoc, planFromEvents, resolveProgram } from '../core/plan.ts';
import { todayISO } from '../core/workout.ts';
import {
  buildRetroactiveGrants,
  compareEvents,
  emptyBattle,
  emptyEquipment,
  emptyGame,
  isoToTs,
  rebuildGame,
  type PendingEvent,
} from '../core/xp.ts';
import { uuid } from '../util/uuid.ts';
import {
  GAME_STATE_VERSION,
  type AppEvent,
  type AppState,
  type BattleProgress,
  type EquipmentState,
  type EventLog,
  type EventType,
  type GameState,
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
 */
export const CURRENT_STATE_VERSION = 3;
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

export function defaultDay(now: Date = new Date()): DayKey {
  const wd = now.getDay(); // 0 = Sunday
  if (wd === 2 || wd === 3) return 'B';
  if (wd >= 4 && wd <= 6) return 'C';
  return 'A';
}

export function emptyUi(now: Date = new Date()): UiState {
  return { view: defaultDay(now), open: {} };
}

export function emptyState(now: number = Date.now()): AppState {
  return {
    schemaVersion: CURRENT_STATE_VERSION,
    sessions: {},
    ui: emptyUi(new Date(now)),
    game: null,
    plan: null,
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
  return {
    world: Math.max(1, Math.floor(numOr(raw['world'], b.world))),
    wave: Math.max(1, Math.floor(numOr(raw['wave'], b.wave))),
    coins: Math.max(0, numOr(raw['coins'], 0)),
    wavesCleared: Math.max(0, Math.floor(numOr(raw['wavesCleared'], 0))),
    miniBossesCleared: Math.max(0, Math.floor(numOr(raw['miniBossesCleared'], 0))),
    bossesDefeated: [...new Set(bosses)],
  };
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
  return out;
}

/**
 * Validate a persisted `game` blob. Returns `null` for anything missing or from
 * a version we don't know — the caller (`ensureGameState`) then rebuilds it from
 * the event log, which is always authoritative.
 *
 * v1 -> v2 (Phase 2) added `battle`; v2 -> v3 (Phase 3) added
 * `battle.bossesDefeated` and `equipment`; v3 -> v4 added the merge-idempotency
 * ledgers `energyGranted` + `prKeys`, which cannot be inferred from an old blob
 * (it only knows the totals, not which grants produced them). An older blob is
 * therefore rejected here and rebuilt from the log, which is lossless because
 * every fact is an event. That rebuild IS the sanctioned migration path.
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
  };
}

function normalizeUi(raw: unknown, now: Date = new Date()): UiState {
  if (!isRecord(raw)) return emptyUi(now);
  const view = raw['view'];
  const open: Record<string, boolean> = {};
  const openRaw = raw['open'];
  if (isRecord(openRaw)) {
    for (const k of Object.keys(openRaw)) open[k] = openRaw[k] === true;
  }
  const v: ViewKey =
    isDayKey(view) || view === 'H' || view === 'CH' || view === 'BT' || view === 'PL'
      ? (view as ViewKey)
      : defaultDay(now);
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
  // 3 -> 4: (future) add your step here and bump CURRENT_STATE_VERSION.
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
  const state: AppState = {
    schemaVersion: CURRENT_STATE_VERSION,
    sessions: normalizeSessions(blob['sessions']),
    ui: normalizeUi(blob['ui'], new Date(now)),
    game: normalizeGame(blob['game']),
    plan: normalizePlanDoc(blob['plan']),
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
    ? normalizeUi(typeof legacyUiRaw === 'string' ? safeParse(legacyUiRaw) : legacyUiRaw, new Date(now))
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
 */
export function ensureGameState(
  state: AppState,
  events: readonly AppEvent[],
  now: number = Date.now(),
): EnsureGameResult {
  if (state.game && state.game.version === GAME_STATE_VERSION) {
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
        // fresh install: the plan is data, and this event erases data.
        state.plan = null;
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
