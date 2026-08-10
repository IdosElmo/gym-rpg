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
import { todayISO } from '../core/workout.ts';
import {
  buildRetroactiveGrants,
  emptyBattle,
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
export const LEGACY_KEY = 'hyp3_data_v1';
export const LEGACY_UI_KEY = 'hyp3_ui_v1';

/**
 * Bump when the shape of `AppState` changes, and add a step to STATE_MIGRATIONS.
 * v2 (Phase 1): the opaque `game` slot became a typed `GameState`.
 */
export const CURRENT_STATE_VERSION = 2;
/** Bump when the shape of `EventLog` changes. */
export const CURRENT_EVENTLOG_VERSION = 1;

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
    meta: { legacyImported: false, createdAt: now, updatedAt: now },
  };
}

export function emptyEventLog(): EventLog {
  return { schemaVersion: CURRENT_EVENTLOG_VERSION, events: [] };
}

export function makeEvent(type: EventType, payload: Record<string, unknown> = {}, ts: number = Date.now()): AppEvent {
  return { id: uuid(), ts, type, payload };
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

/** Phase 2 battle progress. Anything odd falls back to "world 1, wave 1". */
function normalizeBattle(raw: unknown): BattleProgress {
  const b = emptyBattle();
  if (!isRecord(raw)) return b;
  return {
    world: Math.max(1, Math.floor(numOr(raw['world'], b.world))),
    wave: Math.max(1, Math.floor(numOr(raw['wave'], b.wave))),
    coins: Math.max(0, numOr(raw['coins'], 0)),
    wavesCleared: Math.max(0, Math.floor(numOr(raw['wavesCleared'], 0))),
    miniBossesCleared: Math.max(0, Math.floor(numOr(raw['miniBossesCleared'], 0))),
  };
}

/**
 * Validate a persisted `game` blob. Returns `null` for anything missing or from
 * a version we don't know — the caller (`ensureGameState`) then rebuilds it from
 * the event log, which is always authoritative.
 *
 * v1 -> v2 (Phase 2) added `battle`; a v1 blob is therefore rejected here and
 * rebuilt from the log, which is lossless because every fact is an event.
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
    workoutDays: [...new Set(days)].sort(),
    streak: {
      tier: Math.max(0, numOr(streakRaw['tier'], 0)),
      weekStart: typeof streakRaw['weekStart'] === 'string' ? streakRaw['weekStart'] : null,
      daysThisWeek: Math.max(0, numOr(streakRaw['daysThisWeek'], 0)),
      needed: Math.max(1, numOr(streakRaw['needed'], base.streak.needed)),
    },
    battle: normalizeBattle(raw['battle']),
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
    isDayKey(view) || view === 'H' || view === 'CH' || view === 'BT' ? (view as ViewKey) : defaultDay(now);
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
  // 2 -> 3: (future) add your step here and bump CURRENT_STATE_VERSION.
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
];

export function normalizeEvent(raw: unknown): AppEvent | null {
  if (!isRecord(raw)) return null;
  const type = raw['type'];
  if (typeof type !== 'string') return null;
  const ts = typeof raw['ts'] === 'number' && Number.isFinite(raw['ts']) ? raw['ts'] : 0;
  const id = typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : uuid();
  const payload = isRecord(raw['payload']) ? raw['payload'] : {};
  return { id, ts, type: type as EventType, payload };
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

  const grants = materialize(buildRetroactiveGrants(state.sessions, log, today));
  if (grants.length > 0) log = [...log, ...grants];

  const game = rebuildGame(log, today);
  return {
    state: { ...state, game, meta: { ...state.meta, updatedAt: now } },
    events: log,
    changed: true,
  };
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
 */
export function rebuildFromEvents(events: readonly AppEvent[], now: number = Date.now()): AppState {
  const state = emptyState(now);
  const ordered = [...events].sort((a, b) => a.ts - b.ts);

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
        break;
      case 'data_imported': {
        const sessions = p['sessions'];
        if (isRecord(sessions)) state.sessions = normalizeSessions(sessions);
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
