/**
 * e2e.sync.test.ts — TWO DEVICES, ONE ACCOUNT, ONE LONG DAY.
 *
 * Every other test in this repo looks at one seam. This one wires the whole
 * stack together and plays a realistic day:
 *
 *   phone logs a workout in a basement with no signal · tablet spends the
 *   energy on battle waves · both push and pull in different orders · the plan
 *   is edited on one device and then on the other · an old backup file is
 *   imported on one of them · the tab is reloaded mid-scenario · and finally
 *   "🗑 מחיקה" on the phone wipes the account everywhere.
 *
 * Two `LocalStore`s over two separate storages (so two device ids), ONE
 * in-memory backend standing in for Postgres, two `SyncEngine`s, a fake clock.
 * NOTHING here touches a network.
 *
 * At every sync-quiescent point three things are asserted:
 *
 *   1. CONVERGENCE — both devices' live state is deep-equal (minus `ui` and the
 *      per-install `meta` timestamps, neither of which is account data);
 *   2. REPLAY — each device's live state equals `rebuildFromEvents(its log)`,
 *      i.e. the log is still the source of truth after a merge;
 *   3. THE GAME'S INVARIANTS — energy never negative, never more than what was
 *      earned, and every semantic grant key paid exactly once (the merge-safety
 *      ledgers of `GameState` v4).
 *
 * Note that the two LOGS are deliberately NOT compared: coalescing means the
 * tablet never receives the phone's intermediate keystrokes, and `clear()`
 * truncates one log and not the other. Convergence is a property of the STATE
 * the logs fold to, and that is what the app shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { advance, createBattle, setEnergy, tap, type CombatStats } from '../src/core/combat.ts';
import { buyItem, gameOf, onSetCompleted, onWaveCleared, onWorkoutFinished, upgradeItem } from '../src/core/game.ts';
import { upgradeStepCost } from '../src/core/upgrades.ts';
import { equipmentById } from '../src/data/gameContent.ts';
import { clonePlanDoc, defaultPlanDoc, planRows, resolveProgram, savePlan } from '../src/core/plan.ts';
import { getSetData, todayISO } from '../src/core/workout.ts';
import { compareEvents, computeStreak, statsOfGame, weeklyTargetsFromEvents } from '../src/core/xp.ts';
import { PROGRAM, dayOf, type BuiltInDayKey } from '../src/data/program.ts';
import type { AppEvent, AppState, GameState } from '../src/storage/DataStore.ts';
import type { PlanDoc } from '../src/data/planTypes.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { mergeImport } from '../src/storage/merge.ts';
import { parseImport, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import type { LeagueWeekUpload } from '../src/core/leagueSync.ts';
import {
  GhostHandleTakenError,
  type GhostRow,
  type LeagueRawRow,
  type PullPage,
  type SyncBackend,
} from '../src/sync/backend.ts';
import { SyncEngine } from '../src/sync/engine.ts';
import { readSyncMeta } from '../src/sync/meta.ts';
import { buildFeed } from '../src/ui/feed.ts';

/* --------------------------------------------------------------- fixtures */

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const USER = 'user-e2e';
/** Mid-morning, so the whole scenario stays inside one calendar day. */
const START = Date.parse('2025-05-04T09:00:00.000Z');

interface Row {
  seq: number;
  ev: AppEvent;
}

/**
 * The server: rows keyed `(user_id, id)` plus a per-user monotonic counter —
 * the two properties `supabase/schema.sql` guarantees and the engine relies on.
 * A re-push of a known id is a no-op, exactly like `on conflict do nothing`.
 */
class MemoryBackend implements SyncBackend {
  private readonly rows = new Map<string, Row[]>();
  private readonly seqs = new Map<string, number>();
  pushed = 0;

  private listOf(userId: string): Row[] {
    const list = this.rows.get(userId) ?? [];
    this.rows.set(userId, list);
    return list;
  }

  async pushEvents(userId: string, events: readonly AppEvent[]): Promise<void> {
    const list = this.listOf(userId);
    for (const ev of events) {
      this.pushed += 1;
      if (list.some((r) => r.ev.id === ev.id)) continue;
      const seq = (this.seqs.get(userId) ?? 0) + 1;
      this.seqs.set(userId, seq);
      list.push({ seq, ev });
    }
  }

  async pullEvents(userId: string, afterSeq: number, limit: number): Promise<PullPage> {
    const page = this.listOf(userId)
      .filter((r) => r.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    const last = page[page.length - 1];
    return { events: page.map((r) => r.ev), lastSeq: last ? last.seq : afterSeq };
  }

  eventsOf(userId: string): AppEvent[] {
    return this.listOf(userId).map((r) => r.ev);
  }

  /** The `ghosts` table: one row per user, and a unique handle across all of them. */
  readonly ghosts = new Map<string, GhostRow>();

  async publishGhost(userId: string, handle: string, payload: Record<string, unknown>): Promise<void> {
    for (const [owner, row] of this.ghosts) {
      if (owner !== userId && row.handle === handle) throw new GhostHandleTakenError();
    }
    this.ghosts.set(userId, { handle, payload, updatedAt: Date.now() });
  }

  async fetchGhost(handle: string): Promise<GhostRow | null> {
    for (const row of this.ghosts.values()) if (row.handle === handle) return row;
    return null;
  }

  /* -------------------------------------------------------- league weeks */

  /**
   * The `league_weeks` table: one row per `(user_id, week_key)` — its primary
   * key, so a re-publish overwrites — readable by anybody who knows the handle,
   * the same asymmetry the ghosts have.
   */
  readonly leagueRows = new Map<string, LeagueRawRow>();
  leaguePublishes = 0;

  async publishLeagueWeeks(userId: string, handle: string, rows: readonly LeagueWeekUpload[]): Promise<void> {
    this.leaguePublishes += 1;
    for (const row of rows) {
      // Stored under the DATABASE's column names, so every read is exercised
      // against exactly the shape PostgREST hands back.
      this.leagueRows.set(`${userId}|${row.weekKey}`, {
        handle,
        week_key: row.weekKey,
        month_key: row.monthKey,
        score: row.score,
        c: row.c,
        q: row.q,
        l: row.l,
        p: row.p,
        coin: row.coin,
        volume: row.volume,
        days: row.days,
        prs: row.prs,
        updated_at: new Date(Date.now()).toISOString(),
      });
    }
  }

  async fetchLeagueMonth(handle: string, monthKey: string): Promise<LeagueRawRow[]> {
    return [...this.leagueRows.values()].filter((r) => r['handle'] === handle && r['month_key'] === monthKey);
  }
}

/* ---------------------------------------------------------------- devices */

interface Device {
  readonly name: string;
  readonly storage: StorageLike;
  readonly store: LocalStore;
  engine: SyncEngine;
  /** How many times a pull actually changed something here. */
  applied: number;
  online: boolean;
}

function attachEngine(dev: Device, backend: MemoryBackend): SyncEngine {
  return new SyncEngine({
    store: dev.store,
    backend,
    storage: dev.storage,
    now: () => Date.now(),
    onRemoteApplied: () => {
      dev.applied += 1;
    },
    win: null,
    doc: null,
    isOnline: () => dev.online,
    isVisible: () => true,
  });
}

function makeDevice(name: string, backend: MemoryBackend): Device {
  const storage = fakeStorage();
  // `engine` is attached immediately below — it needs the device to report to.
  const dev = { name, storage, store: new LocalStore(storage), applied: 0, online: true } as Device;
  dev.engine = attachEngine(dev, backend);
  dev.engine.start();
  return dev;
}

/** Reload the tab: a brand new engine over the SAME storage and the same store. */
function restart(dev: Device, backend: MemoryBackend): void {
  dev.engine.dispose();
  dev.engine = attachEngine(dev, backend);
  dev.engine.start();
}

/** One full cycle (push → pull → merge) on one device, awaited to the end. */
async function cycle(dev: Device): Promise<void> {
  await dev.engine.sync();
  await dev.engine.settled();
}

/**
 * Sync everyone until nobody has anything left to say. Two rounds is enough for
 * two devices (A pushes, B pulls + pushes, A pulls), and the extra pass doubles
 * as a proof that a redundant cycle changes nothing.
 */
async function quiesce(...devices: Device[]): Promise<void> {
  for (let round = 0; round < 2; round += 1) for (const dev of devices) await cycle(dev);
}

/** Let the clock (and every timer hanging off it) move forward. */
async function passTime(ms: number, ...devices: Device[]): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (const dev of devices) await dev.engine.settled();
}

/* ------------------------------------------------------------- the player */

function ex(day: BuiltInDayKey, index: number) {
  const exercise = PROGRAM[day].exercises[index];
  if (!exercise) throw new Error(`no exercise ${day}#${index}`);
  return exercise;
}

/**
 * Check one set, exactly the way `ui/workout.ts` does it: mirror the value into
 * the session, append the event, then grant XP + energy.
 */
function checkSet(dev: Device, date: string, day: BuiltInDayKey, index: number, i: number, w: string, r: string): void {
  const exercise = ex(day, index);
  dev.store.update((draft) => {
    const d = getSetData(draft, day, exercise.id, i, true, date);
    if (!d) return;
    d.w = w;
    d.r = r;
    d.done = true;
  });
  dev.store.append('set_completed', { date, day, exId: exercise.id, setIndex: i, w, r });
  onSetCompleted(dev.store, { date, day, ex: exercise, setIndex: i, w, r }, new Date(Date.now()));
}

/** The keystroke flood behind one weight field — four events, one real value. */
function typeWeight(dev: Device, date: string, day: BuiltInDayKey, index: number, i: number, keys: readonly string[]): void {
  const exercise = ex(day, index);
  for (const w of keys) {
    dev.store.update((draft) => {
      const d = getSetData(draft, day, exercise.id, i, true, date);
      if (d) d.w = w;
    });
    dev.store.append('set_logged', { date, day, exId: exercise.id, setIndex: i, w, r: '10' });
  }
}

/** A whole workout day, set by set, ending in the completion bonus. */
function logWorkout(dev: Device, date: string, day: BuiltInDayKey): void {
  const exercises = PROGRAM[day].exercises;
  for (let e = 0; e < exercises.length; e += 1) {
    const exercise = exercises[e];
    if (!exercise) continue;
    for (let i = 0; i < exercise.sets; i += 1) checkSet(dev, date, day, e, i, '40', '10');
  }
  dev.store.append('workout_finished', { date, day });
  onWorkoutFinished(dev.store, { date, day }, new Date(Date.now()));
}

function combatStats(dev: Device): CombatStats {
  const s = statsOfGame(gameOf(dev.store));
  return {
    atk: s.atk,
    def: s.def,
    maxHp: s.maxHp,
    attackIntervalMs: s.attackIntervalMs,
    critChance: s.critChance,
    critMultiplier: s.critMultiplier,
    regen: s.regen,
  };
}

/** Fight until `waves` waves are down, persisting each one like the arena does. */
function fightWaves(dev: Device, waves: number, seed = 4242): number {
  const game = gameOf(dev.store);
  const state = createBattle({
    seed,
    world: game.battle.world,
    wave: game.battle.wave,
    energy: game.energy,
    stats: combatStats(dev),
  });
  const tick = BALANCE.combat.tickMs;
  let cleared = 0;
  let sinceTap = 0;
  for (let ms = 0; ms < 900_000 && cleared < waves; ms += tick) {
    const stats = combatStats(dev);
    const events = [...advance(state, tick, stats)];
    if (state.status === 'fighting') {
      sinceTap += tick;
      if (sinceTap >= BALANCE.combat.tap.minIntervalMs * 1.5) {
        sinceTap = 0;
        events.push(...tap(state, stats).events);
      }
    }
    for (const evt of events) {
      if (evt.kind !== 'wave_cleared') continue;
      onWaveCleared(dev.store, evt.result, new Date(Date.now()));
      setEnergy(state, gameOf(dev.store).energy);
      cleared += 1;
    }
    if (state.status === 'resting' || state.status === 'gated') break;
  }
  return cleared;
}

/* ---------------------------------------------------------- the assertions */

/**
 * Everything that belongs to the ACCOUNT. `ui` (which tab you are on) and
 * `meta.createdAt/updatedAt` (when this install was made and last written) are
 * per-device by design — `storage/merge.ts` carries them across a merge instead
 * of replaying them, so they are excluded here for the same reason.
 *
 * `streak` is folded out too: it is a function of TODAY as well as of the log,
 * so it is compared on its own against `computeStreak` (as in `loop.test.ts`).
 */
function accountState(state: AppState): Record<string, unknown> {
  const game = state.game;
  return {
    schemaVersion: state.schemaVersion,
    sessions: state.sessions,
    plan: state.plan,
    game: game ? { ...game, streak: null } : null,
  };
}

function replayOf(dev: Device): AppState {
  return rebuildFromEvents(dev.store.getEvents(), Date.now());
}

/**
 * The part of the log the ledgers actually reflect: everything after the last
 * `data_cleared`. A wiped device keeps the events it pulled before the wipe —
 * they fold to nothing, and they must not be expected in `granted` either.
 */
function liveSuffix(events: readonly AppEvent[]): AppEvent[] {
  const ordered = [...events].sort(compareEvents);
  let start = 0;
  for (let i = 0; i < ordered.length; i += 1) if (ordered[i]?.type === 'data_cleared') start = i + 1;
  return ordered.slice(start);
}

/** Grant keys of every `xp_gained` in a log — what `granted` must contain. */
function grantKeysIn(events: readonly AppEvent[], type: 'xp_gained' | 'pr_achieved'): Set<string> {
  const keys = new Set<string>();
  for (const ev of events) {
    if (ev.type !== type) continue;
    const date = ev.payload['date'];
    const exId = ev.payload['exId'];
    const setIndex = ev.payload['setIndex'];
    if (typeof date === 'string' && typeof exId === 'string' && typeof setIndex === 'number') {
      keys.add(`${date}|${exId}|${setIndex}`);
    }
  }
  return keys;
}

/**
 * The game rules that a merge must never break, whatever order events arrive in.
 */
function expectInvariants(dev: Device): void {
  const game: GameState = gameOf(dev.store);
  const events = liveSuffix(dev.store.getEvents());

  expect(game.energy).toBeGreaterThanOrEqual(0);
  // Energy is `earned − spent`, floored at 0: it can never exceed what real
  // training paid, no matter how many devices spent it concurrently.
  expect(game.energy).toBeLessThanOrEqual(game.energyEarned);
  expect(game.totalXp).toBeGreaterThanOrEqual(0);
  expect(game.battle.coins).toBeGreaterThanOrEqual(0);

  // NO DOUBLE PAYOUT: one ledger entry per semantic key present in the log,
  // however many events (from however many devices) carry that key.
  expect(new Set(Object.keys(game.granted))).toEqual(grantKeysIn(events, 'xp_gained'));
  expect(new Set(Object.keys(game.prKeys))).toEqual(grantKeysIn(events, 'pr_achieved'));
  expect(game.prCount).toBe(Object.keys(game.prKeys).length);

  const energyKeys = new Set<string>();
  for (const ev of events) {
    if (ev.type !== 'energy_gained') continue;
    const key = ev.payload['key'];
    if (typeof key === 'string') energyKeys.add(key);
  }
  expect(new Set(Object.keys(game.energyGranted))).toEqual(energyKeys);
}

/**
 * Live state === replay of this device's own log. The whole architecture.
 *
 * The streak is checked separately because it is a function of TODAY as well as
 * of the log — and, since the plan carries the weekly target, of the plan events
 * in that same log (`weeklyTargetsFromEvents`).
 */
function expectReplayEquivalence(dev: Device): void {
  const live = dev.store.getState();
  const replayed = replayOf(dev);
  expect(accountState(replayed)).toEqual(accountState(live));
  expect(replayed.game?.streak).toEqual(
    computeStreak(
      live.game?.workoutDays ?? [],
      todayISO(),
      weeklyTargetsFromEvents(dev.store.getEvents()),
    ),
  );
}

/** The point of the whole feature: two devices showing the same app. */
function expectConverged(a: Device, b: Device): void {
  expect(accountState(a.store.getState())).toEqual(accountState(b.store.getState()));
  expect(gameOf(a.store).streak).toEqual(gameOf(b.store).streak);
  expect(accountState(replayOf(a))).toEqual(accountState(replayOf(b)));
  expectReplayEquivalence(a);
  expectReplayEquivalence(b);
  expectInvariants(a);
  expectInvariants(b);
}

/* ------------------------------------------------------------- the backup */

const LEGACY_BACKUP = {
  sessions: {
    '2025-01-05': {
      day: 'A',
      ex: {
        a1: [
          { w: '40', r: '10', done: true },
          { w: '45', r: '10', done: true },
        ],
        a5: [{ w: '12', r: '12', done: true }],
      },
    },
    '2025-01-07': { day: 'B', ex: { b1: [{ w: '50', r: '10', done: true }] } },
  },
};

/* ------------------------------------------------------------------ tests */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('two devices, one account', () => {
  it('converges through offline training, battles, plan edits, an import and a wipe', async () => {
    const backend = new MemoryBackend();
    const phone = makeDevice('phone', backend);
    const tablet = makeDevice('tablet', backend);
    const today = todayISO(new Date(START));

    // Two installs, two device ids — otherwise nothing below proves anything.
    expect(phone.store.getDeviceId()).not.toBe(tablet.store.getDeviceId());

    await phone.engine.linkAccount(USER);
    await tablet.engine.linkAccount(USER);
    await quiesce(phone, tablet);
    expectConverged(phone, tablet);

    /* -- 1. the phone trains in a basement: no signal, no data lost --------- */

    phone.online = false;
    typeWeight(phone, today, 'A', 0, 0, ['4', '42', '42.', '42.5']);
    logWorkout(phone, today, 'A');
    await passTime(3_000, phone, tablet); // the debounce + coalesce windows fire

    const trained = gameOf(phone.store);
    expect(trained.totalXp).toBeGreaterThan(0);
    expect(trained.energy).toBeGreaterThan(0);
    expect(phone.engine.pendingCount()).toBeGreaterThan(0);
    expect(phone.engine.getStatus().kind).toBe('offline');
    expect(backend.eventsOf(USER)).toHaveLength(0);
    expectReplayEquivalence(phone);

    /* -- 2. the tab is reloaded mid-basement: the outbox survives ----------- */

    const before = readSyncMeta(phone.storage);
    expect(before.outbox.length).toBeGreaterThan(0);
    expect(before.userId).toBe(USER);
    restart(phone, backend);
    const after = phone.engine.getMeta();
    expect(after.outbox).toEqual(before.outbox);
    expect(after.cursor).toBe(before.cursor);
    expect(after.userId).toBe(USER);
    expect(after.deviceId).toBe(phone.store.getDeviceId());
    expect(phone.engine.pendingCount()).toBe(before.outbox.length);

    /* -- 3. back on wifi: the revived engine finishes the job --------------- */

    phone.online = true;
    await cycle(phone);
    expect(phone.engine.pendingCount()).toBe(0);
    // Exactly the pending events went up — a revived engine resumes the outbox,
    // it does not re-upload a log it has no reason to doubt.
    expect(backend.pushed).toBe(before.outbox.length);
    expect(phone.engine.getStatus().kind).toBe('idle');
    expect(phone.applied).toBe(0); // nothing to learn — it is the only writer

    // The keystrokes were coalesced: the cloud holds ONE row for that set.
    const uploadedTyping = backend
      .eventsOf(USER)
      .filter((e) => e.type === 'set_logged' && e.payload['setIndex'] === 0);
    expect(uploadedTyping).toHaveLength(1);
    expect(uploadedTyping[0]?.payload['w']).toBe('42.5');
    expect(phone.store.getEvents().filter((e) => e.type === 'set_logged')).toHaveLength(4);

    await cycle(tablet);
    expect(tablet.applied).toBe(1); // one repaint for the whole workout
    expectConverged(phone, tablet);

    // The merge PAID NOTHING EXTRA: the tablet holds the phone's numbers, once.
    expect(gameOf(tablet.store).totalXp).toBe(trained.totalXp);
    expect(gameOf(tablet.store).energy).toBe(trained.energy);
    expect(gameOf(tablet.store).energyEarned).toBe(trained.energyEarned);

    /* -- 4. concurrent work: the tablet fights while the phone logs a set --- */

    await passTime(60_000, phone, tablet);
    tablet.online = false;
    const energyBefore = gameOf(tablet.store).energy;
    const cleared = fightWaves(tablet, 4);
    expect(cleared).toBe(4);
    expect(gameOf(tablet.store).battle.wavesCleared).toBe(4);
    expect(gameOf(tablet.store).energy).toBeLessThan(energyBefore);
    expect(gameOf(tablet.store).energy).toBeGreaterThanOrEqual(0);

    // …at the very same moment, on the phone, a set of the next day.
    checkSet(phone, today, 'B', 0, 0, '60', '8');
    await passTime(1_000, phone);

    // This time the TABLET goes first — the merge must not care who spoke when.
    tablet.online = true;
    await quiesce(tablet, phone);
    expectConverged(phone, tablet);
    expect(gameOf(phone.store).battle.wavesCleared).toBe(4);
    expect(gameOf(phone.store).battle.coins).toBe(gameOf(tablet.store).battle.coins);

    /* -- 5. the plan is edited on the phone, then LATER on the tablet ------- */

    const phonePlan = clonePlanDoc(defaultPlanDoc());
    const rowA = planRows(phonePlan, 'A')[0];
    if (!rowA) throw new Error('empty day A');
    rowA.sets = 5;
    expect(savePlan(phone.store, phonePlan, Date.now()).ok).toBe(true);
    await quiesce(phone, tablet);
    expectConverged(phone, tablet);
    expect(dayOf(resolveProgram(tablet.store.getState().plan), 'A')?.exercises[0]?.sets).toBe(5);

    await passTime(120_000, phone, tablet); // an hour of the day goes by
    const tabletPlan: PlanDoc = clonePlanDoc(tablet.store.getState().plan ?? defaultPlanDoc());
    const rowB = planRows(tabletPlan, 'A')[0];
    if (!rowB) throw new Error('empty day A');
    rowB.sets = 2;
    rowB.rest = 45;
    expect(savePlan(tablet.store, tabletPlan, Date.now()).ok).toBe(true);
    await quiesce(tablet, phone);

    // The later save wins ON BOTH DEVICES — including the one that wrote the
    // earlier document and had to be talked out of it.
    expectConverged(phone, tablet);
    for (const dev of [phone, tablet]) {
      const day = dayOf(resolveProgram(dev.store.getState().plan), 'A');
      expect(day?.exercises[0]?.sets).toBe(2);
      expect(day?.exercises[0]?.rest).toBe(45);
    }
    expect(phone.store.getState().plan?.rev).toBe(tablet.store.getState().plan?.rev);

    /* -- 6. an old backup file is imported on the phone (signed in ⇒ additive) */

    const parsed = parseImport(JSON.stringify(LEGACY_BACKUP), Date.now());
    expect(parsed).not.toBeNull();
    const xpBeforeImport = gameOf(phone.store).totalXp;
    const merged = mergeImport(phone.store, parsed!, Date.now());
    expect(merged.added).toBeGreaterThan(0);
    // `mergeImport` lands through `replaceAll`, which the engine cannot see —
    // this is the `onLocalMerge` hook `main.ts` wires for exactly that reason.
    phone.engine.enqueueAll();
    await quiesce(phone, tablet);

    expectConverged(phone, tablet);
    expect(Object.keys(phone.store.getState().sessions).sort()).toEqual(['2025-01-05', '2025-01-07', today]);
    expect(gameOf(phone.store).totalXp).toBeGreaterThan(xpBeforeImport);
    expect(gameOf(tablet.store).totalXp).toBe(gameOf(phone.store).totalXp);
    // Retro grants pay XP but never energy, on either device.
    expect(gameOf(tablet.store).energyEarned).toBe(gameOf(phone.store).energyEarned);

    // The import is the ONE thing that writes a `data_merged` marker, and the
    // history feed explains it — on the device that pulled it, too.
    for (const dev of [phone, tablet]) {
      const markers = dev.store.getEvents().filter((e) => e.type === 'data_merged');
      expect(markers).toHaveLength(1);
      expect(markers[0]?.payload['source']).toBe('json_import');
      const line = buildFeed(dev.store.getEvents(), 200).find((i) => i.cls === 'import');
      expect(line?.text).toContain('יובאו נתונים מקובץ');
    }
    // …and a cloud pull writes NOTHING: markers per pull would ping-pong for ever.
    expect(backend.eventsOf(USER).filter((e) => e.payload['source'] === 'sync')).toHaveLength(0);

    /* -- 7. redundant cycles are free: nothing changes, nothing repaints ---- */

    const quietPhone = JSON.stringify(accountState(phone.store.getState()));
    const appliedBefore = phone.applied + tablet.applied;
    await passTime(180_000, phone, tablet); // three poll intervals
    await quiesce(phone, tablet);
    expect(JSON.stringify(accountState(phone.store.getState()))).toBe(quietPhone);
    expect(phone.applied + tablet.applied).toBe(appliedBefore);

    /* -- 8. 🗑 מחיקה on the phone wipes the ACCOUNT, not just the phone ----- */

    phone.store.clear();
    expect(phone.store.getEvents().map((e) => e.type)).toEqual(['data_cleared']);
    await quiesce(phone, tablet);

    for (const dev of [phone, tablet]) {
      const state = dev.store.getState();
      expect(state.sessions).toEqual({});
      expect(state.plan).toBeNull();
      expect(gameOf(dev.store).totalXp).toBe(0);
      expect(gameOf(dev.store).energy).toBe(0);
      expect(gameOf(dev.store).battle.wavesCleared).toBe(0);
      expect(gameOf(dev.store).granted).toEqual({});
    }
    // The tablet still HOLDS its history — it simply folds to nothing after the
    // wipe. Convergence is a property of the state, never of the two logs.
    expect(tablet.store.getEvents().length).toBeGreaterThan(1);
    expectConverged(phone, tablet);

    phone.engine.dispose();
    tablet.engine.dispose();
  }, 60_000);

  /* ------------------------------------------------------------------ */

  it('converges on a plan with its own days, trained on custom day keys', async () => {
    // The motivating case of the variable-day feature, end to end: a 4-days-a-
    // week A/B split — two workouts, four training days, keys the built-in
    // program has never heard of — logged on one device and shown on the other.
    const backend = new MemoryBackend();
    const phone = makeDevice('phone', backend);
    const tablet = makeDevice('tablet', backend);
    const today = todayISO(new Date(START));

    await phone.engine.linkAccount(USER);
    await tablet.engine.linkAccount(USER);
    await quiesce(phone, tablet);

    /* -- 1. the phone saves the A/B plan ---------------------------------- */

    const plan: PlanDoc = {
      version: 2,
      rev: 0,
      days: [
        { key: 'd_alef', label: "חלק א'", weekdays: [0, 3], exercises: [
          { id: 'a1', sets: 3, reps: '8–10', rest: 90 },
          { id: 'a2', sets: 3, reps: '8–10', rest: 90 },
        ] },
        { key: 'd_bet', label: "חלק ב'", weekdays: [2, 4], exercises: [
          { id: 'b1', sets: 3, reps: '8–10', rest: 90 },
        ] },
      ],
      weeklyTarget: 4,
      customExercises: [],
    };
    expect(savePlan(phone.store, plan, Date.now()).ok).toBe(true);
    await quiesce(phone, tablet);
    expectConverged(phone, tablet);

    // Both devices render TWO tabs, in the plan's order, with its labels.
    for (const dev of [phone, tablet]) {
      const program = resolveProgram(dev.store.getState().plan);
      expect(program.days.map((d) => d.key)).toEqual(['d_alef', 'd_bet']);
      expect(program.days.map((d) => d.label)).toEqual(["חלק א'", "חלק ב'"]);
      expect(program.weeklyTarget).toBe(4);
      // …and a perfect week now means four days, on both of them
      expect(gameOf(dev.store).streak.needed).toBe(4);
    }

    /* -- 2. the phone trains "חלק א'" — a day key that is not A/B/C -------- */

    const alef = dayOf(resolveProgram(phone.store.getState().plan), 'd_alef');
    if (!alef) throw new Error('no day d_alef');
    for (const exercise of alef.exercises) {
      for (let i = 0; i < exercise.sets; i += 1) {
        phone.store.update((draft) => {
          const d = getSetData(draft, 'd_alef', exercise.id, i, true, today);
          if (!d) return;
          d.w = '40';
          d.r = '10';
          d.done = true;
        });
        phone.store.append('set_completed', {
          date: today,
          day: 'd_alef',
          exId: exercise.id,
          setIndex: i,
          w: '40',
          r: '10',
        });
        onSetCompleted(
          phone.store,
          { date: today, day: 'd_alef', ex: exercise, setIndex: i, w: '40', r: '10' },
          new Date(Date.now()),
        );
      }
    }
    phone.store.append('workout_finished', { date: today, day: 'd_alef' });
    onWorkoutFinished(phone.store, { date: today, day: 'd_alef' }, new Date(Date.now()));

    const trained = gameOf(phone.store);
    expect(trained.totalXp).toBeGreaterThan(0);
    expect(trained.energy).toBeGreaterThan(0);
    expect(phone.store.getState().sessions[today]?.day).toBe('d_alef');

    /* -- 3. the tablet learns all of it, day key and all ------------------- */

    await passTime(3_000, phone, tablet);
    await quiesce(phone, tablet);
    expectConverged(phone, tablet);

    expect(gameOf(tablet.store).totalXp).toBe(trained.totalXp);
    expect(gameOf(tablet.store).energy).toBe(trained.energy);
    // The custom day key survived the whole round trip — it was never coerced.
    expect(tablet.store.getState().sessions[today]?.day).toBe('d_alef');
    expect(
      tablet.store.getEvents().filter((e) => e.type === 'set_completed' && e.payload['day'] === 'd_alef').length,
    ).toBeGreaterThan(0);
    // The completion bonus was paid once, for a day the program only knows
    // because the PLAN travelled with it.
    expect(gameOf(tablet.store).bonusDays[today]).toBe(true);

    /* -- 4. the tablet trains the OTHER day, and the phone catches up ------ */

    const bet = dayOf(resolveProgram(tablet.store.getState().plan), 'd_bet');
    if (!bet) throw new Error('no day d_bet');
    const b1 = bet.exercises[0];
    if (!b1) throw new Error('empty day');
    tablet.store.update((draft) => {
      const d = getSetData(draft, 'd_bet', b1.id, 0, true, today);
      if (d) {
        d.w = '60';
        d.r = '8';
        d.done = true;
      }
    });
    tablet.store.append('set_completed', { date: today, day: 'd_bet', exId: b1.id, setIndex: 0, w: '60', r: '8' });
    onSetCompleted(
      tablet.store,
      { date: today, day: 'd_bet', ex: b1, setIndex: 0, w: '60', r: '8' },
      new Date(Date.now()),
    );

    await passTime(3_000, phone, tablet);
    await quiesce(tablet, phone);
    expectConverged(phone, tablet);
    // Last write wins for the day label of a shared date, on both devices alike.
    expect(phone.store.getState().sessions[today]?.ex[b1.id]?.[0]?.w).toBe('60');

    /* -- 5. resetting the plan takes the target back to the built-in one --- */

    savePlan(tablet.store, null, Date.now());
    await quiesce(tablet, phone);
    expectConverged(phone, tablet);
    for (const dev of [phone, tablet]) {
      expect(dev.store.getState().plan).toBeNull();
      expect(resolveProgram(dev.store.getState().plan).days.map((d) => d.key)).toEqual(['A', 'B', 'C']);
      expect(gameOf(dev.store).streak.needed).toBe(BALANCE.streak.daysPerWeek);
      // the workout logged on a day key the plan no longer defines is still there
      expect(dev.store.getState().sessions[today]?.day).toBe('d_bet');
    }

    phone.engine.dispose();
    tablet.engine.dispose();
  }, 60_000);

  /* ------------------------------------------------------------------ */

  /**
   * THE CASE THE UPGRADE ECONOMY HAD TO BE DESIGNED AROUND: both devices are
   * offline, both look at the same owned item, both tap "⬆ שדרוג".
   *
   * Two `item_upgraded` events with the same `toLevel` and different uuids reach
   * the cloud; id-dedupe cannot collapse them. The high-water-mark rule
   * (`GameState.equipment.upgrades`) is what makes the account converge on +1
   * and charge for it exactly once — and, because gear feeds `deriveStats`, the
   * two devices must also agree on the character's ATK afterwards.
   */
  it('converges on ONE level when both devices buy the same upgrade offline', async () => {
    const backend = new MemoryBackend();
    const phone = makeDevice('phone', backend);
    const tablet = makeDevice('tablet', backend);
    const today = todayISO(new Date(START));

    await phone.engine.linkAccount(USER);
    await tablet.engine.linkAccount(USER);
    await quiesce(phone, tablet);

    /* -- 1. the phone earns a purse and buys the gloves ------------------- */

    onWaveCleared(
      phone.store,
      { world: 1, wave: 1, miniBoss: false, enemyId: 'w1_rat', coins: 3_000, energySpent: 0, seed: 7, durationMs: 900 },
      new Date(Date.now()),
    );
    expect(buyItem(phone.store, 'gloves_1', new Date(Date.now())).ok).toBe(true);
    await passTime(3_000, phone, tablet);
    await quiesce(phone, tablet);
    expectConverged(phone, tablet);

    const purse = gameOf(phone.store).battle.coins;
    const step = upgradeStepCost(equipmentById('gloves_1')?.cost ?? 0, 1);
    const bare = statsOfGame(gameOf(phone.store)).atk;

    /* -- 2. both go offline and both upgrade the SAME item ---------------- */

    phone.online = false;
    tablet.online = false;
    expect(upgradeItem(phone.store, 'gloves_1', new Date(Date.now())).toLevel).toBe(1);
    await passTime(1_000, phone, tablet);
    expect(upgradeItem(tablet.store, 'gloves_1', new Date(Date.now())).toLevel).toBe(1);
    await passTime(3_000, phone, tablet);

    // each device, alone, believes it paid for the level — and it did
    for (const dev of [phone, tablet]) {
      expect(gameOf(dev.store).equipment.upgrades).toEqual({ gloves_1: 1 });
      expect(gameOf(dev.store).battle.coins).toBe(purse - step);
      expectReplayEquivalence(dev);
    }

    /* -- 3. back online: the union charges ONCE --------------------------- */

    phone.online = true;
    tablet.online = true;
    await quiesce(phone, tablet);
    expectConverged(phone, tablet);

    expect(backend.eventsOf(USER).filter((e) => e.type === 'item_upgraded')).toHaveLength(2);
    for (const dev of [phone, tablet]) {
      const game = gameOf(dev.store);
      expect(game.equipment.upgrades).toEqual({ gloves_1: 1 }); // not +2
      expect(game.battle.coins).toBe(purse - step); // not 2 × step
      expect(statsOfGame(game).atk).toBeGreaterThan(bare); // the gear got better
    }
    expect(statsOfGame(gameOf(phone.store))).toEqual(statsOfGame(gameOf(tablet.store)));

    /* -- 4. the ladder still climbs, from either device ------------------- */

    expect(upgradeItem(tablet.store, 'gloves_1', new Date(Date.now())).toLevel).toBe(2);
    await passTime(3_000, phone, tablet);
    await quiesce(tablet, phone);
    expectConverged(phone, tablet);
    for (const dev of [phone, tablet]) {
      expect(gameOf(dev.store).equipment.upgrades).toEqual({ gloves_1: 2 });
    }
    // …and the adventure feed on the phone tells the story of both purchases
    const upgrades = buildFeed(phone.store.getEvents(), 80).filter((i) => i.icon === '⬆');
    expect(upgrades.length).toBeGreaterThanOrEqual(2);
    expect(upgrades[0]?.text).toContain('+2');
    expect(today.length).toBe(10);

    phone.engine.dispose();
    tablet.engine.dispose();
  }, 60_000);
});
