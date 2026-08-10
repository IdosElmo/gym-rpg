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
 */

import { isDayKey, type DayKey } from '../data/program.ts';
import { uuid } from '../util/uuid.ts';
import type {
  AppEvent,
  AppState,
  EventLog,
  EventType,
  Session,
  SetEntry,
  UiState,
  ViewKey,
} from './DataStore.ts';

/* ------------------------------------------------------------- constants */

export const STATE_KEY = 'gymrpg_state_v1';
export const EVENTS_KEY = 'gymrpg_events_v1';
export const LEGACY_KEY = 'hyp3_data_v1';
export const LEGACY_UI_KEY = 'hyp3_ui_v1';

/** Bump when the shape of `AppState` changes, and add a step to STATE_MIGRATIONS. */
export const CURRENT_STATE_VERSION = 1;
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

function normalizeUi(raw: unknown, now: Date = new Date()): UiState {
  if (!isRecord(raw)) return emptyUi(now);
  const view = raw['view'];
  const open: Record<string, boolean> = {};
  const openRaw = raw['open'];
  if (isRecord(openRaw)) {
    for (const k of Object.keys(openRaw)) open[k] = openRaw[k] === true;
  }
  const v: ViewKey = isDayKey(view) || view === 'H' ? (view as ViewKey) : defaultDay(now);
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
  // 1 -> 2: (future) add your step here and bump CURRENT_STATE_VERSION.
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
    game: isRecord(blob['game']) ? (blob['game'] as AppState['game']) : null,
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
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isNaN(t) ? 0 : t;
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
    return { state, events, source: 'gym-rpg' };
  }

  if (isRecord(raw['sessions'])) {
    const base = emptyState(now);
    const res = importLegacy(base, raw, null, now);
    if (!res.imported) return null;
    const events = res.events.map((e) =>
      e.type === 'session_imported' ? { ...e, payload: { ...e.payload, source: 'json_import' } } : e,
    );
    return { state: res.state, events, source: 'legacy' };
  }

  return null;
}

/* ------------------------------------------------------- event replay */

/**
 * Deterministically rebuild state from the append-only log.
 *
 * Phase 0 replays the workout/data events, which is enough to prove the log is
 * a faithful source of truth. Phase 1+ extends the switch below with
 * `xp_gained` / `level_up` / `battle_won` / … to rebuild `state.game`; the
 * `game` accumulator is already threaded through for that purpose.
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
      // TODO(phase 1+): xp_gained / level_up / pr_achieved / streak_changed /
      // battle_won / boss_defeated / item_equipped -> fold into `state.game`.
      default:
        break;
    }
  }

  state.meta.updatedAt = ordered.length > 0 ? (ordered[ordered.length - 1]?.ts ?? now) : now;
  return state;
}
