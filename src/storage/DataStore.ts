/**
 * DataStore — the ONLY way the app is allowed to touch persistence.
 *
 * UI code must never read/write `localStorage` directly. Everything goes through
 * this interface so that a cloud backend (Supabase, …) can be dropped in later
 * without touching the UI: implement `DataStore` and swap it in `main.ts`.
 *
 * Two things are persisted side by side:
 *   1. the current state snapshot (`AppState`) — fast reads for rendering;
 *   2. an append-only `EventLog` — the source of truth, and what cloud sync
 *      merges (`storage/merge.ts`, `sync/engine.ts`).
 * Both blobs carry a `schemaVersion` and are read through `storage/migrate.ts`.
 */

import type { EquipmentSlot } from '../data/gameContent.ts';
import type { LeagueItemKind } from '../data/leaguePools.ts';
import type { PlanDoc } from '../data/planTypes.ts';
import type { BodyPart, DayKey } from '../data/program.ts';

/* ------------------------------------------------------------------ state */

/** One logged set. Values stay STRINGS, exactly like the legacy app. */
export interface SetEntry {
  w: string;
  r: string;
  done: boolean;
}

/**
 * A day's session. Arrays are sparse-tolerant (`null` holes) because the legacy
 * format created set slots on demand — kept as-is so imports are lossless.
 *
 * `day` is a PLAN DAY KEY (`DayKey`, i.e. a string): 'A'/'B'/'C' for the
 * built-in program and for everything logged before plans had their own days,
 * `d_…` for a day the user created. It is never rewritten on read — a session
 * whose day no longer exists in the plan keeps saying what it always said.
 */
export interface Session {
  day: DayKey;
  ex: Record<string, (SetEntry | null)[]>;
}

/**
 * A day key = one workout screen, plus seven RESERVED keys: `CH` = דמות,
 * `BT` = קרב (battle), `LG` = ליגה (the 🏆 monthly league), `ST` = הגדרות
 * (settings), `H` = היסטוריה, `SS` = סטטיסטיקות (the 📊 screen),
 * `PL` = תוכנית (the plan editor). A plan may not use those as day keys
 * (`isDayKey` refuses them).
 *
 * The nav is TWO levels (see `ui/nav.ts`): three fixed hubs, each with its own
 * inner tab row. Every view above belongs to exactly one hub — day keys and
 * `PL` to אימון, `BT`/`CH`/`LG` to קרב, `ST`/`H`/`SS` to הגדרות — so the stored
 * view alone still decides the whole screen, exactly as it did with one flat bar.
 *
 * `PL` deliberately has NO tab of its own: it is reached from the ⚙️ button in
 * the workout header and from the plan card on the settings screen.
 *
 * `ST` was the ONE view id the two-level redesign added; `SS` (📊 סטטיסטיקות,
 * the settings hub's third inner tab) came with the statistics screen, and `LG`
 * (🏆 הליגה, the game hub's third inner tab) is the newest.
 * Everything a build ever persisted — including a bare `'H'` — is still a valid
 * view and still lands on the screen it always named: view ids are only ever
 * ADDED, never renamed or reused, which is what makes an install left on any
 * older screen open on exactly that screen after the update.
 */
export type ViewKey = DayKey | 'CH' | 'BT' | 'H' | 'PL' | 'ST' | 'SS' | 'LG';

export interface UiState {
  view: ViewKey;
  open: Record<string, boolean>;
}

/* -------------------------------------------------------------- game state */

/**
 * Version of the `GameState` blob. Bump it when the shape below changes — an
 * unrecognised version is rejected by `normalizeGame` and simply REBUILT from
 * the event log, which is always the source of truth. That rebuild is the
 * sanctioned migration path for this blob (see `ensureGameState`).
 *
 * v4 (merge-safe core) added the idempotency ledgers `energyGranted` + `prKeys`.
 * v5 (the character roster) added `characters`.
 * v6 (body × skin) reshaped `characters`: `owned` now holds SKIN ids (one purchase,
 * both bodies) and `selected` a `<skin>_<body>` combination id. The two shapes
 * overlap enough to be confusable (`'robot'` was a v5 selection and is a v6
 * skin id), so the version is bumped rather than sniffed — an old blob is
 * rejected and rebuilt from the log, which is lossless.
 * v7 (equipment upgrades) added `equipment.upgrades` — the per-item +0…+3 level
 * bought with coins. A v6 blob simply has no such field, and inventing `{}` for
 * it would silently ERASE upgrades that are sitting in the log; the blob is
 * therefore rejected and replayed, which restores every level exactly.
 * v8 (the daily challenge) added `daily` — the per-date ledger of attempts. Same
 * reasoning again: a v7 blob has no such field, and an empty ledger would mean
 * "never attempted anything", which would hand back an attempt the log says was
 * already spent. Rejected and replayed, which restores every run exactly.
 * v9 (ghost duels) added `duels` — the per-(date, opponent) ledger of fights
 * against other accounts' characters. Same reasoning a third time: a v8 blob has
 * no such field, an empty ledger would say "you never fought anyone today" and
 * hand back a duel the log already recorded as spent, so it is rejected and
 * replayed instead.
 * v10 (dev mode) added `devUsed` + the two dev ledgers `devKeys` / `devCycles`.
 * A fourth time the same argument: a v9 blob has no such fields, and inventing
 * empty ones would say "this account never used a dev grant" — which would drop
 * the 🛠 flag off the published ghost and hand back a daily/duel reset the log
 * already recorded. Rejected and replayed, which is lossless.
 * v11 (הליגה) added `league` — the weekly-score ledger, the 🔵 purse and the
 * monthly redemption / challenge ledgers. A FIFTH time the same argument: a v10
 * blob has no such field, and inventing an empty one would say "no week was ever
 * closed" — which would let a lazy close re-close weeks the log already closed
 * and re-mint their coins. Rejected and replayed, which restores every week,
 * every coin and every redemption exactly.
 * v12 (the league's best-grade ledger) changes NO FIELD AT ALL — and is bumped
 * anyway, which is the one case worth spelling out. This blob is a CACHE OF A
 * FOLD, and v12 changed the fold's rule: `league.weeks[week]` used to hold the
 * FIRST close of that week in the `(ts, id)` order and now holds the BEST-scoring
 * one (`applyGameEvent`, and the corrective re-close in `core/league.ts` that
 * needs it). A v11 cache can therefore disagree with a replay of its own log —
 * the shape matches, so nothing would ever notice, and a device could sit on a
 * week that was graded from an incomplete log for ever. Rejecting it replays the
 * log under the new rule on the first boot after the update, which is exactly
 * what the migration path is for and costs one rebuild.
 */
export const GAME_STATE_VERSION = 12;

/** XP pool of one body part. `level` is DERIVED from `xp` (see core/xp.ts). */
export interface PartProgress {
  xp: number;
  level: number;
}

export type PartsProgress = Record<BodyPart, PartProgress>;

export interface StreakState {
  /** Permanent stacking tier; +10% all stats per tier. */
  tier: number;
  /** ISO date (Sunday) of the week currently in progress. */
  weekStart: string | null;
  /** Distinct workout days logged so far in the current week. */
  daysThisWeek: number;
  /**
   * Days needed for a "perfect week" — the ACTIVE plan's `weeklyTarget` (3 for
   * the built-in program). Past weeks are judged against the target the plan had
   * back then, which is folded out of the log (`weeklyTargetsFromEvents`).
   */
  needed: number;
}

/**
 * Battle progress (Phase 2). Every field is folded from `wave_cleared` events,
 * so it replays exactly like the rest of the game state.
 *
 * There is deliberately NO RNG state here: a battle session is seeded when the
 * קרב tab opens and each cleared wave records the seed it ran with, which keeps
 * "live state === rebuildFromEvents(log)" trivially true.
 */
export interface BattleProgress {
  /** Current world (1-based, see WORLDS in data/gameContent.ts). */
  world: number;
  /** Next wave to fight inside that world (1-based). */
  wave: number;
  /** Coins earned from waves and bosses — the shop spends them. */
  coins: number;
  /** Lifetime counters, for the history feed and the trophy shelf. */
  wavesCleared: number;
  miniBossesCleared: number;
  /**
   * Ids of the world bosses already defeated, in the order they fell. Each one
   * is a permanent trophy on the character screen, and the LAST world's boss
   * additionally switches world 4 into its endless "champion" mode.
   */
  bossesDefeated: string[];
}

/**
 * The ONE counted attempt of one calendar date's daily challenge.
 *
 * `score` is the number of gauntlet waves fully cleared (0…10) and `tiebreak`
 * the remaining HP percentage the run ended on — together they order two runs
 * that cleared the same number of waves.
 */
export interface DailyRunRecord {
  score: number;
  tiebreak: number;
  coins: number;
  /** True when every wave of the gauntlet fell. */
  complete: boolean;
}

/**
 * Daily-challenge progress — the ledger and everything derived from it.
 *
 * `runs` is the ONLY folded field: date -> the one attempt that counted. It is
 * keyed by the CHALLENGE DATE, which is exactly the semantic key the reducer is
 * idempotent on, so two devices that both played (or both re-received) the same
 * day's run converge on one record and one payout.
 *
 * Everything else below is DERIVED from `runs` in `finalizeGame`, the same way
 * body-part levels are derived from XP: a derived field cannot disagree with the
 * log after a merge, so the totals, the record and the streaks are exact by
 * construction rather than by careful bookkeeping.
 */
export interface DailyChallengeState {
  /** date (YYYY-MM-DD) -> the one attempt counted for that date. */
  runs: Record<string, DailyRunRecord>;
  /** Derived: how many dates were attempted at all. */
  attempts: number;
  /** Derived: how many of them cleared all ten waves. */
  completed: number;
  /** Derived: the best (score, tiebreak) ever, and the date that produced it. */
  bestScore: number;
  bestTiebreak: number;
  bestDate: string | null;
  /** Derived: consecutive days attempted, counted back from today. */
  streak: number;
  /** Derived: the longest such run ever. */
  bestStreak: number;
}

/**
 * The ONE counted duel of one (date, opponent) pair.
 *
 * `score` is 0 or 1 — a duel is a single wave, so "cleared it" IS "won" — and
 * `tiebreak` the HP percentage the fight ended on, which is the only honest
 * measure of how close it was.
 *
 * A duel's coins are NOT kept here. They went into the one purse the game has
 * (`battle.coins`) the moment the event folded, and `won` already says which of
 * the two `BALANCE.duel` prices was paid — storing the number a second time
 * would be a field that can disagree with the log after a merge.
 */
export interface GhostDuelRecord {
  /** The opponent's handle — also the second half of the ledger key. */
  opponent: string;
  won: boolean;
  score: number;
  tiebreak: number;
}

/** Lifetime record against one opponent — derived, never folded. */
export interface GhostDuelTally {
  wins: number;
  losses: number;
  duels: number;
}

/**
 * Ghost-duel progress — the ledger and everything derived from it.
 *
 * `runs` is the ONLY folded field: `"<date>|<handle>"` -> the one duel that
 * counted for that pair. That key is exactly the semantic key the reducer is
 * idempotent on, so two devices that both fought the same opponent on the same
 * day converge on one record and one fee, in either merge order.
 *
 * Everything else is DERIVED in `finalizeGame`, exactly like the daily
 * challenge's totals and body-part levels: a derived field cannot disagree with
 * the log after a merge.
 */
export interface GhostDuelState {
  /** "date|opponentHandle" -> the one duel counted for that pair. */
  runs: Record<string, GhostDuelRecord>;
  /** Derived: lifetime totals across every opponent. */
  duels: number;
  wins: number;
  losses: number;
  /** Derived: the same tallies, per opponent handle. */
  byOpponent: Record<string, GhostDuelTally>;
}

/* ------------------------------------------------------------- הליגה */

/**
 * ONE closed week of the league — the authoritative grade of a Sun–Sat week.
 *
 * Everything here is folded verbatim from the `league_week_closed` payload
 * rather than recomputed on read, for the same reason `wave_cleared` carries its
 * own coins: the sessions a week was graded on can be edited later (a JSON
 * import, a merge), and a closed week must keep saying what it said. The score
 * IS the record.
 */
export interface LeagueWeekRecord {
  /** 0…100, one decimal — `100 × (0.4C + 0.3Q + 0.2L + 0.1P)`. */
  score: number;
  /** The four components, 0…1 each (see `core/league.ts`). */
  c: number;
  q: number;
  l: number;
  p: number;
  /** True when the week minted its 🔵 (C ≥ 1 and Q ≥ 0.8). */
  coin: boolean;
  /** Volume points the week actually lifted — what the next weeks compare to. */
  volume: number;
  /** Distinct training days. */
  days: number;
  /** PRs the week produced (dev grants excluded), uncapped. */
  prs: number;
}

/** ONE redeemed pool item — once per (month, item), whatever it cost. */
export interface LeagueRedemption {
  itemId: string;
  kind: LeagueItemKind;
  /** 🔵 charged, already clamped to `BALANCE.league.maxCost` on the way in. */
  cost: number;
}

/** The ONE challenge staked for a month — first in `(ts, id)` order wins. */
export interface LeagueChallengeStake {
  challengeId: string;
  /** 🔵 staked. */
  cost: number;
}

/** Derived per-month totals — the leaderboard row this account contributes. */
export interface LeagueMonthTotal {
  /** 'YYYY-MM'. */
  month: string;
  /** Σ of the month's weekly scores, one decimal. */
  score: number;
  /** How many of its weeks are closed. */
  weeks: number;
  /** 🔵 those weeks minted. */
  coins: number;
}

/**
 * הליגה — the monthly leaderboard fought with weekly 🔵.
 *
 * FOUR LEDGERS AND NOTHING ELSE. `weeks`, `redemptions`, `challenges` and
 * `completions` are the only folded fields, and each is a map keyed by its own
 * semantic key, so the union of two devices' logs unions exactly:
 *
 *   weeks[weekKey]                  — one grade per Sun–Sat week
 *   redemptions["<month>|<itemId>"] — one redemption per item per month
 *   challenges[month]               — one staked challenge per month
 *   completions["<month>|<id>"]     — the 🔵 bonus a completion claimed
 *
 * EVERYTHING ELSE IS DERIVED in `finalizeGame` — `coins`, `coinsEarned`,
 * `coinsSpent` and `months` — exactly like the daily challenge's totals and the
 * six body-part levels. A derived total cannot disagree with the log after a
 * merge, whereas a purse incremented per event would have to be defended against
 * every duplicate. That is the whole convergence story of the feature: the coins
 * accrue because the LEDGER accepted a week, never because an event arrived.
 */
export interface LeagueState {
  /** Derived: `max(0, earned − spent)` — the 🔵 purse. */
  coins: number;
  /** Derived: 🔵 ever minted (weeks + completed challenge bonuses). */
  coinsEarned: number;
  /** Derived: 🔵 ever spent (redemptions + challenge stakes). */
  coinsSpent: number;
  /** weekKey (the week's SUNDAY, ISO) -> its one closing grade. */
  weeks: Record<string, LeagueWeekRecord>;
  /** "YYYY-MM|itemId" -> the one redemption of that item that month. */
  redemptions: Record<string, LeagueRedemption>;
  /** "YYYY-MM" -> the one challenge staked for that month. */
  challenges: Record<string, LeagueChallengeStake>;
  /** "YYYY-MM|challengeId" -> the 🔵 bonus its completion claimed. */
  completions: Record<string, number>;
  /** Derived: 'YYYY-MM' -> the month's totals. */
  months: Record<string, LeagueMonthTotal>;
}

/**
 * Which combination the player is playing, and which SKINS they bought.
 *
 * `owned` holds purchased SKIN ids ONLY (`'robot'`, `'ninja'`, …) — never a
 * body-specific id: one purchase unlocks the skin on both bodies. The free base
 * skin (`data/characters.ts`, `cost: 0`) is owned by definition and is never
 * written to the log — representation is not a purchase, and nothing about
 * choosing a body should depend on an event having survived a merge.
 *
 * `selected` is one combination id, `<skin>_<m|f>` (`'hero_m'`, `'robot_f'`),
 * last-write-wins in the log's `(ts, id)` order, so two devices that both
 * switched body or skin converge on the same drawing. Body and skin live in ONE
 * field on purpose: you always play exactly one pair, and two fields folded from
 * two events could disagree after a merge.
 */
export interface CharactersState {
  /** Ids of the SKINS bought so far (permanent, like equipment). */
  owned: string[];
  /** The body × skin combination currently being played. */
  selected: string;
}

/** Owned + equipped + upgraded shop items. All folded from the event log. */
export interface EquipmentState {
  /** Every item id ever bought (purchases are permanent). */
  owned: string[];
  /** slot -> item id currently worn. A missing slot means "nothing worn". */
  equipped: Partial<Record<EquipmentSlot, string>>;
  /**
   * item id -> upgrade level (1…`BALANCE.upgrades.maxLevel`). A missing entry
   * means +0, so a wardrobe that never upgraded anything is `{}` — exactly what
   * every save written before v7 effectively said.
   *
   * The level is a HIGH-WATER MARK, never a counter: `item_upgraded` carries the
   * level it reaches (`toLevel`) and the reducer applies it only when the item
   * is below it. That is what makes two devices that each bought "+1" while
   * offline converge on +1 and charge for it exactly once (see `core/xp.ts`).
   */
  upgrades: Record<string, number>;
}

/**
 * The whole game layer. Every field is deterministically derivable by replaying
 * the event log (`rebuildGame` in `core/xp.ts`), so this blob is a cache — if it
 * is ever missing or from an unknown version it is simply rebuilt.
 */
export interface GameState {
  version: number;
  parts: PartsProgress;
  /** Headline character level = floor(average of the six part levels). */
  level: number;
  totalXp: number;
  /** Battle energy available to spend (Phase 2 consumes it). */
  energy: number;
  /** Lifetime energy earned — never spent, for stats/achievements. */
  energyEarned: number;
  prCount: number;
  /** exerciseId -> best volume (weight×reps) ever granted, for PR + volumeFactor. */
  best: Record<string, number>;
  /** "date|exId|setIndex" of every set that already paid out — the anti-farm guard. */
  granted: Record<string, true>;
  /** Dates that already received the workout-completion bonus. */
  bonusDays: Record<string, true>;
  /**
   * Keys of every `energy_gained` event that was already paid (`key` field of
   * the payload: the grant key for a set, `bonus|<date>` for a completion).
   * Merging two devices' logs can produce semantically duplicate grants with
   * DIFFERENT event ids; this ledger is what stops them paying twice.
   * Events WITHOUT a `key` (logs written before v4) apply unguarded.
   */
  energyGranted: Record<string, true>;
  /** "date|exId|setIndex" of every `pr_achieved` already counted (same reason). */
  prKeys: Record<string, true>;
  /** Distinct dates of LIVE (non-retroactive) training — the streak source. */
  workoutDays: string[];
  streak: StreakState;
  /** Phase 2 — battle progress (world / wave / coins / bosses). */
  battle: BattleProgress;
  /** Phase 3 — the coin shop's owned + equipped items. */
  equipment: EquipmentState;
  /** Phase 5 — the character roster: bought skins + the one being played. */
  characters: CharactersState;
  /** Phase 7 — the daily challenge: one attempt per calendar date. */
  daily: DailyChallengeState;
  /** Phase 8 — ghost duels: one fight per opponent per calendar date. */
  duels: GhostDuelState;
  /** Phase 11 — הליגה: one grade per closed week, 🔵 and the monthly ledgers. */
  league: LeagueState;
  /**
   * Phase 9 — DEV MODE. True while this save carries at least one dev grant
   * that a `dev_purge` has not covered.
   *
   * It is folded like everything else, but the fold only ever SEES dev events
   * that survived the purge pre-pass (`liveEvents` in core/xp.ts), so the flag
   * means exactly "an uncovered dev grant exists" — which is why a purge (or a
   * `data_cleared`) puts it back to false, and why the published ghost's 🛠
   * marker disappears with it.
   */
  devUsed: boolean;
  /**
   * Keys (`dev|<uuid>`) of every dev GRANT already applied — the idempotency
   * ledger for dev XP and dev coins, exactly like `energyGranted` is for energy
   * (dev energy grants ride that existing ledger, since `energy_gained` already
   * has a `key` guard). Two devices folding the union of their logs pay a dev
   * grant once, in either order.
   */
  devKeys: Record<string, true>;
  /**
   * `"<scope>|<date>"` -> the highest `dev_reset` CYCLE applied for it.
   *
   * A HIGH-WATER MARK, exactly like `equipment.upgrades`: the event names the
   * cycle it opens and the reducer applies it only while the ledger is below it,
   * so two devices that both opened "cycle 1" for the same date converge on one
   * extra attempt in either merge order — never two.
   */
  devCycles: Record<string, number>;
}

export interface AppMeta {
  /** Whether the legacy `hyp3_data_v1` blob was already imported. */
  legacyImported: boolean;
  /** ms epoch of the legacy import, if it happened. */
  legacyImportedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppState {
  schemaVersion: number;
  sessions: Record<string, Session>;
  ui: UiState;
  game: GameState | null;
  /**
   * The user's edited training plan, or `null` for "the built-in program".
   *
   * Like `game`, this is a CACHE of the log: it is folded from `plan_updated`
   * events (last one in the `(ts, id)` order wins) by `rebuildFromEvents`.
   * `null` is not an error state — it is the normal state of anyone who never
   * opened the plan editor, and `resolveProgram(null)` returns the built-in
   * `PROGRAM` object itself, so nothing about the app changes until a save.
   */
  plan: PlanDoc | null;
  meta: AppMeta;
}

/* ------------------------------------------------------------------ events */

/**
 * Append-only event types. Phase 0 emits the workout + import ones; the game
 * phases add their own without changing the log format.
 */
export type EventType =
  // Phase 0 — workout & data lifecycle
  | 'set_logged'
  | 'set_completed'
  | 'set_uncompleted'
  | 'workout_finished'
  | 'legacy_import'
  | 'session_imported'
  | 'data_imported'
  | 'data_cleared'
  // Phase 1 — game layer (XP / levels / streak)
  | 'xp_gained'
  | 'energy_gained'
  | 'level_up'
  | 'pr_achieved'
  | 'streak_changed'
  // Phase 2 — battle. ONE event per cleared wave; attack ticks are never events.
  | 'wave_cleared'
  // Phase 3 — world bosses and the coin shop
  | 'boss_defeated'
  | 'coins_spent'
  | 'item_equipped'
  // Phase 6 — per-item equipment upgrades bought with coins
  | 'item_upgraded'
  // Phase 7 — the daily challenge. ONE event per run, idempotent per DATE.
  | 'daily_challenge'
  // Phase 8 — ghost duels. ONE event per duel, idempotent per (DATE, OPPONENT).
  | 'ghost_duel'
  // Phase 11 — הליגה. One close per WEEK, one redemption per (MONTH, ITEM), one
  // staked challenge per MONTH and one completion per (MONTH, CHALLENGE).
  | 'league_week_closed'
  | 'league_reward_redeemed'
  | 'league_challenge_set'
  | 'league_challenge_completed'
  // Phase 5 — the cosmetic character roster
  | 'character_purchased'
  | 'character_selected'
  // Phase 9 — dev mode. Real events, marked `dev: true`, through the normal
  // pipeline: they sync, they replay and they can be taken back (`dev_purge`).
  | 'coins_granted'
  | 'dev_reset'
  | 'dev_purge'
  // Phase 4 — editable plans and multi-device merges (declared here so an older
  // build can already round-trip them; both reducers ignore what they don't know)
  | 'plan_updated'
  | 'data_merged';

export interface AppEvent {
  readonly id: string;
  /** epoch ms */
  readonly ts: number;
  readonly type: EventType;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Id of the install that created the event (`LocalStore` stamps it). Optional:
   * events written before the device id existed simply have none. It is never
   * used for ordering — the total order is `(ts, id)` — only for bookkeeping
   * (e.g. "which of my own events may I clamp a clock against").
   */
  readonly device?: string;
}

export interface EventLog {
  schemaVersion: number;
  events: AppEvent[];
}

/** Payload shapes emitted by Phase 0 (documented for downstream phases). */
export interface SetEventPayload extends Record<string, unknown> {
  date: string;
  day: DayKey;
  exId: string;
  setIndex: number;
  w: string;
  r: string;
}

export interface SessionImportedPayload extends Record<string, unknown> {
  date: string;
  day: DayKey;
  ex: Record<string, (SetEntry | null)[]>;
  source: 'legacy_v1' | 'json_import' | 'recovered';
}

/* ------------------------------------------------ Phase 1 game payloads */

/**
 * Where an XP (or energy) grant came from.
 *
 * `'dev'` is the dev panel — a grant that did not come from training. It is a
 * source rather than a separate event type on purpose: the payload shape is
 * identical, so replay, merge and every consumer keep working unchanged, and the
 * one thing that IS different (this XP is not training) is said in one word.
 */
export type XpSource = 'set' | 'workout_complete' | 'dev';

/**
 * THE authoritative XP record: replaying these rebuilds `GameState` exactly.
 * `retro: true` marks XP granted for history that predates the game layer —
 * it pays XP but never energy and never feeds the streak.
 */
export interface XpGainedPayload extends Record<string, unknown> {
  date: string;
  day?: DayKey;
  exId?: string;
  setIndex?: number;
  source: XpSource;
  /** part -> xp; the parts always come from `bodyPartWeights(exercise)`. */
  parts: Partial<Record<BodyPart, number>>;
  total: number;
  /** weight×reps of the set (0 for the completion bonus) — feeds `best`. */
  volume?: number;
  factor?: number;
  pr?: boolean;
  retro: boolean;
  /**
   * Dev grants only. `dev: true` marks the event everywhere (feed, ghost flag,
   * purge) and `key` is its idempotency unit — a dev grant has no
   * (date, exercise, set) slot to be guarded by, so it carries `dev|<uuid>` and
   * the reducer folds it through `game.devKeys`.
   */
  dev?: true;
  key?: string;
}

export interface EnergyGainedPayload extends Record<string, unknown> {
  date: string;
  amount: number;
  source: XpSource;
  retro: boolean;
  /**
   * Idempotency key: `date|exId|setIndex` for a set, `bonus|<date>` for the
   * workout-completion bonus. Optional ONLY for backward compatibility with
   * logs written before v4 — every new event carries one.
   *
   * A dev grant reuses this exact guard with a `dev|<uuid>` key: unique per
   * grant, so the ⚡ arrives once however many times the event is merged.
   */
  key?: string;
  /** Dev mode: this energy did not come from training. */
  dev?: true;
}

export interface PrAchievedPayload extends Record<string, unknown> {
  date: string;
  exId: string;
  setIndex: number;
  volume: number;
  previousBest: number;
  retro: boolean;
}

export interface LevelUpPayload extends Record<string, unknown> {
  date: string;
  part: BodyPart;
  from: number;
  to: number;
  retro: boolean;
  /** Dev mode: the level came from a dev grant, not from training. */
  dev?: true;
}

export interface StreakChangedPayload extends Record<string, unknown> {
  from: number;
  to: number;
  weekStart: string | null;
}

/* ----------------------------------------------- Phase 2 battle payloads */

/**
 * THE battle record — emitted once per cleared wave and nothing else.
 *
 * Individual attacks are NOT events: they are a deterministic function of
 * `seed` (see core/combat.ts) and logging them would bloat the log by three
 * orders of magnitude. This one payload carries everything the state needs:
 * where the player is, what it cost and what it paid.
 */
export interface WaveClearedPayload extends Record<string, unknown> {
  date: string;
  world: number;
  wave: number;
  miniBoss: boolean;
  enemyId: string;
  coins: number;
  /** ⚡ charged for this wave (charged on CLEAR, never on a defeat). */
  energySpent: number;
  /** Seed the cleared attempt ran with — makes the fight replayable. */
  seed: number;
  durationMs: number;
}

/* ------------------------------------------- Phase 3 boss / shop payloads */

/**
 * A world boss went down. Like `wave_cleared`, the payload is AUTHORITATIVE:
 * `nextWorld`/`nextWave` say exactly where the player lands, so a replay never
 * has to re-derive the unlock rule (and old logs keep replaying if it changes).
 */
export interface BossDefeatedPayload extends Record<string, unknown> {
  date: string;
  world: number;
  wave: number;
  bossId: string;
  coins: number;
  energySpent: number;
  seed: number;
  durationMs: number;
  /** Where the battle continues: the next world at wave 1, or endless mode. */
  nextWorld: number;
  nextWave: number;
  /** True when this was the LAST world's boss — world 4 turns endless. */
  endgame: boolean;
}

/** A shop purchase. Coins leave the purse and the item joins `owned`. */
export interface CoinsSpentPayload extends Record<string, unknown> {
  date: string;
  itemId: string;
  slot: EquipmentSlot;
  cost: number;
}

/** An item was put on (`itemId`) or taken off (`itemId: null`). */
export interface ItemEquippedPayload extends Record<string, unknown> {
  date: string;
  slot: EquipmentSlot;
  itemId: string | null;
}

/**
 * ONE upgrade step on ONE owned item. The payload is AUTHORITATIVE in exactly
 * the way `boss_defeated` is: it names the level this step REACHES and the price
 * that was quoted for it, so a replay never has to re-derive today's cost curve
 * and an old log keeps folding to the same purse if the curve is ever retuned.
 *
 * CONVERGENCE. The reducer applies the event only when
 * `upgrades[itemId] < toLevel`, and charges `cost` only when it applies. So:
 *   - a duplicate (or an out-of-order older step) is a no-op — no double charge;
 *   - two devices that each bought "+1" offline both write `toLevel: 1`; folding
 *     the union in EITHER order lands on +1 and pays once;
 *   - a device that got to +2 while another got to +1 folds to +2 and pays for
 *     both steps exactly once each — which is what one device would have paid.
 */
export interface ItemUpgradedPayload extends Record<string, unknown> {
  date: string;
  itemId: string;
  slot: EquipmentSlot;
  /** The level this step reaches: 1…`BALANCE.upgrades.maxLevel`. */
  toLevel: number;
  /** Coins charged for THIS step (not the cumulative price of the level). */
  cost: number;
}

/* --------------------------------------------- Phase 7 daily challenge */

/**
 * ONE finished daily-challenge run — the only event the whole feature writes.
 *
 * AUTHORITATIVE, like `boss_defeated` and `item_upgraded`: the score, the purse
 * and the fee are carried as DATA, so a replay never re-simulates the gauntlet
 * and never re-derives today's reward table. An old log keeps folding to the
 * same coins even after `BALANCE.daily` is retuned.
 *
 * IDEMPOTENT PER DATE — the rule the feature rests on. `date` is the semantic
 * key (there is exactly one challenge per calendar date, and exactly one attempt
 * at it), so the reducer applies the event only while `daily.runs[date]` is
 * empty, and charges the fee / pays the coins only when it applies:
 *
 *   - a duplicate of a run already counted is a total no-op — no second fee, no
 *     second payout;
 *   - two devices that each played the same day's challenge offline write two
 *     events with different uuids and the SAME `date`; folding the union in
 *     EITHER order keeps the FIRST one in the log's `(ts, id)` order and pays
 *     once. Both devices land on the same record because that order is a
 *     property of the event set, not of who received what when;
 *   - the run that "loses" is not lost data: it stays in the log for ever and is
 *     simply not counted, exactly like a duplicate retro grant.
 *
 * `outcome` distinguishes a full clear from a knock-out and from a run the
 * player walked out on. All three are real attempts and all three are recorded —
 * what a forfeit does NOT do is pay for waves that were never cleared.
 */
export interface DailyChallengePayload extends Record<string, unknown> {
  /** Calendar date of the challenge (YYYY-MM-DD) — the idempotency key. */
  date: string;
  /** Seed the gauntlet was generated from — makes the run reproducible. */
  seed: number;
  /** Waves fully cleared (0…10). `score` is the same number, named for the UI. */
  wavesCleared: number;
  score: number;
  /** Tiebreak between equal scores: remaining HP %, 0 after a knock-out. */
  tiebreak: number;
  /** Coins earned: the cleared waves plus the completion bonus on a full clear. */
  coins: number;
  /** ⚡ charged for the ATTEMPT — once, never per wave. */
  energySpent: number;
  complete: boolean;
  outcome: 'complete' | 'defeated' | 'forfeit';
  durationMs: number;
}

/* -------------------------------------------------- Phase 8 duel payload */

/**
 * ONE ghost duel — the only event the feature writes, and the only place a duel
 * leaves a trace at all.
 *
 * IDEMPOTENT PER (DATE, OPPONENT), the daily challenge's idiom one field wider:
 * the reducer derives `"<date>|<handle>"` from the payload and applies the event
 * only while that slot is empty. So one duel per opponent per day, the fee is
 * charged once, and two devices that both fought the same person offline
 * converge — in EITHER merge order — on the run that comes first in the log's
 * `(ts, id)` order, because that order is a property of the event SET.
 *
 * WHAT IS AND IS NOT IN HERE. The result is authoritative (`won`, `score`,
 * `tiebreak`, `coins`), so a REPLAY never re-simulates the fight: the opponent's
 * ghost will look different tomorrow, and history must not change with it — and
 * a retune of `BALANCE.duel` never rewrites what yesterday's duel paid. The
 * `snapshotHash` records WHICH version of their character was fought — enough to
 * tell two duels apart forensically, and not enough to reconstruct anything.
 *
 * THE COINS ARE CAPPED ON THE WAY IN. Authoritative does not mean believed: the
 * reducer clamps `coins` to `max(BALANCE.duel.winCoins, lossCoins)` and pays it
 * only when the ledger slot was still free, so neither a crafted event nor a
 * duplicated one can overpay. An event written before duels paid at all has no
 * `coins` field and folds as zero — which is exactly what it was worth.
 */
export interface GhostDuelPayload extends Record<string, unknown> {
  /** Calendar date of the duel (YYYY-MM-DD) — half the idempotency key. */
  date: string;
  /** The opponent's handle, canonical form — the other half. */
  opponentHandle: string;
  /** Their display name at the time (cosmetic; the handle is the identity). */
  opponentName: string;
  /** Did the ghost go down? */
  won: boolean;
  /** 1 when the ghost fell, 0 otherwise — the same "waves cleared" number. */
  score: number;
  /** Remaining HP % at the end (0 after a knock-out) — how close it was. */
  tiebreak: number;
  /** Coins this duel paid: `winCoins` when it was won, `lossCoins` otherwise. */
  coins: number;
  /** The duel's seed: `hash('duel|<sorted handles>|<date>')`. */
  seed: number;
  /** ⚡ charged for the duel — once, when it is recorded. */
  energySpent: number;
  /** Fingerprint of the ghost payload that was actually fought. */
  snapshotHash: string;
  outcome: 'complete' | 'defeated' | 'forfeit';
  durationMs: number;
}

/* ------------------------------------------------- Phase 11 הליגה payloads */

/**
 * ONE closed week of the league — the event the whole scoring engine exists to
 * write, and the only place a 🔵 can come from.
 *
 * AUTHORITATIVE, exactly like `daily_challenge`: the score, its four components
 * and the volume the week lifted ride in the payload as DATA, so a replay never
 * re-grades a week against today's `BALANCE.league` and a closed week keeps
 * saying what it said even after the sessions behind it are re-imported.
 *
 * IDEMPOTENT PER WEEK — the rule the feature rests on. `weekKey` (the week's
 * SUNDAY, `YYYY-MM-DD`) is the semantic key, so the reducer applies the event
 * only while `league.weeks[weekKey]` is empty:
 *
 *   - a duplicate of a week already closed is a total no-op — no second 🔵;
 *   - two devices that each closed the same week offline write two events with
 *     different uuids and the SAME `weekKey`; folding the union in EITHER order
 *     keeps the FIRST in the log's `(ts, id)` order and mints ONE coin. Both
 *     devices land on the same record because that order is a property of the
 *     event SET — and because closing is a deterministic function of the log,
 *     the two events say the same thing anyway;
 *   - the close that "loses" is not lost data: it stays in the log for ever and
 *     is simply not counted, exactly like a duplicate retro grant.
 *
 * The 🔵 itself is NOT a field here and is never folded: the purse is DERIVED
 * from the ledger in `finalizeGame`, so "the coin arrives when the ledger
 * accepts the week" is true by construction rather than by careful bookkeeping.
 */
export interface LeagueWeekClosedPayload extends Record<string, unknown> {
  /** The week's SUNDAY (YYYY-MM-DD) — the idempotency key. */
  weekKey: string;
  /** ISO date the close was written on (bookkeeping, like every payload). */
  date: string;
  /** 0…100, one decimal. */
  score: number;
  /** Consistency, completion, load, PRs — each 0…1. */
  c: number;
  q: number;
  l: number;
  p: number;
  /** Did the week mint its 🔵? */
  coin: boolean;
  /** Volume points lifted — what later weeks' baselines are drawn from. */
  volume: number;
  /** Distinct training days. */
  days: number;
  /** PRs the week produced. */
  prs: number;
}

/**
 * ONE pool item redeemed for 🔵 — once per (month, item).
 *
 * The reducer enforces exactly two things: the ledger key is free, and the price
 * is believed only up to `BALANCE.league.maxCost`. It deliberately does NOT
 * enforce WHO may spend: winning the month is a CROSS-ACCOUNT fact (it depends
 * on the opponent's scores, which are not in this log at all), so gating the
 * spend on it here would make the fold depend on data the fold cannot see.
 * Spending rights are therefore a UI + social-contract layer (stages 3/4); the
 * ledger's job is "once per month, and only what you can afford".
 */
export interface LeagueRewardRedeemedPayload extends Record<string, unknown> {
  /** 'YYYY-MM' — half the idempotency key. */
  month: string;
  /** The pool item's id — the other half. */
  itemId: string;
  kind: LeagueItemKind;
  /** 🔵 charged, clamped by the reducer. */
  cost: number;
  date: string;
}

/**
 * The ONE challenge staked for a month. First in the `(ts, id)` order wins, so
 * two devices that each picked a challenge offline converge on the same one —
 * and the stake is charged once.
 */
export interface LeagueChallengeSetPayload extends Record<string, unknown> {
  /** 'YYYY-MM' — the idempotency key (one slot per month). */
  month: string;
  challengeId: string;
  /** 🔵 staked, clamped by the reducer. */
  cost: number;
  date: string;
}

/**
 * A staked challenge was completed — SELF-REPORTED in v1, which is the right
 * level of trust for a two-person league.
 *
 * Idempotent per (month, challenge). The bonus is clamped to
 * `BALANCE.league.maxBonus`, and it is only PAID when the month's staked
 * challenge is this one — a completion of a challenge nobody staked mints
 * nothing, which is what stops a crafted event from printing 🔵.
 */
export interface LeagueChallengeCompletedPayload extends Record<string, unknown> {
  month: string;
  challengeId: string;
  /** 🔵 the completion claims. */
  bonus: number;
  date: string;
}

/* ------------------------------------------------ Phase 5 roster payloads */

/**
 * A character SKIN was bought. Coins leave the purse and the skin id joins
 * `characters.owned` — permanently, exactly like an equipment purchase, and for
 * BOTH bodies at once.
 *
 * `characterId` carries a SKIN id (`'robot'`) — which is exactly what the
 * single-body roster wrote, so every purchase ever logged still folds into the
 * right skin. A combination id (`'robot_f'`) is accepted too and reduced to its
 * skin, so no build of the app can mint an unlock that means something else.
 *
 * The reducer is idempotent by SKIN ID (not by event id): two devices that each
 * bought the same skin offline produce two events with different uuids, and the
 * union must charge exactly once. Only the free skin (`cost: 0`) never appears
 * here — it is owned without ever being bought.
 */
export interface CharacterPurchasedPayload extends Record<string, unknown> {
  date: string;
  characterId: string;
  cost: number;
}

/**
 * The player switched to another body × skin combination — the single event
 * behind both "wear another skin" and "switch body".
 *
 * `characterId` is a combination id (`'hero_f'`, `'robot_m'`). A legacy id from
 * the single-body roster is resolved on fold: `'hero_m'`/`'hero_f'` already ARE
 * combination ids, and a bare skin id maps to the body that skin was sold on
 * (`'robot'` → `'robot_m'`, `'ninja'` → `'ninja_f'`).
 *
 * Pure LWW in the log's `(ts, id)` order — the last one folded wins — and an id
 * that is unknown or whose skin is not owned is IGNORED, so a merge can never
 * leave a device playing something it does not have.
 */
export interface CharacterSelectedPayload extends Record<string, unknown> {
  date: string;
  characterId: string;
}

/* ----------------------------------------------- Phase 9 dev-mode payloads */

/**
 * Coins granted OUTSIDE the battle economy — today, only the dev panel mints
 * one. It exists because there is no other honest way to pay coins: every
 * existing coin payer (`wave_cleared`, `boss_defeated`, `daily_challenge`) also
 * carries a fight, and pretending a dev grant cleared a wave would put a lie in
 * the log and in the feed.
 *
 * IDEMPOTENT BY `key` — the same rule as `energy_gained`, and the reason the
 * field is REQUIRED here rather than optional: an unkeyed grant would double-pay
 * the moment two devices merged, so the reducer refuses to pay one at all.
 */
export interface CoinsGrantedPayload extends Record<string, unknown> {
  date: string;
  amount: number;
  /** `dev|<uuid>` — unique per grant, the idempotency unit. */
  key: string;
  source: 'dev';
  dev: true;
}

/** What a dev reset re-opens: today's daily challenge, or today's duels. */
export type DevResetScope = 'daily' | 'duels';

/**
 * Re-open one day's ledger so it can be played again.
 *
 * It does NOT refund anything and it does not touch history: it clears exactly
 * the entries the "one per day" rule reads (`daily.runs[date]`, or every
 * `"<date>|…"` duel), so the rule keeps holding — one attempt per RESET CYCLE.
 *
 * CONVERGENCE, the `item_upgraded` idiom: `cycle` is the cycle this event OPENS
 * (current + 1) and the reducer applies it only while `devCycles["<scope>|<date>"]`
 * is below it. Two devices that each pressed "reset" while offline both write
 * cycle 1; folding the union in EITHER order opens one cycle, i.e. one extra
 * attempt — never two — and both devices land on the same ledger.
 */
export interface DevResetPayload extends Record<string, unknown> {
  date: string;
  scope: DevResetScope;
  /** The cycle this reset opens (1, 2, 3 …) — a high-water mark. */
  cycle: number;
  key: string;
  dev: true;
}

/**
 * TAKE BACK every dev grant — the undo of the whole feature.
 *
 * It carries no numbers because it is not a counter-grant: folding the log in
 * the `(ts, id)` total order, every `dev: true` GRANT that sorts BEFORE a purge
 * is simply skipped (`liveEvents` in core/xp.ts), so the state that comes out is
 * byte-identical to the state of a log that never had them — which is what makes
 * it exact rather than approximate, and what makes it idempotent (a second purge
 * covers the same nothing).
 *
 * Dev grants written AFTER the purge apply normally: purge, then keep testing.
 *
 * WHAT IT DOES NOT UNDO: real events that happened while the grants were in
 * force. Coins won in a battle that only ran because dev energy paid for it stay
 * won. A purge reverts GRANTS, not history — the log is still the log.
 */
export interface DevPurgePayload extends Record<string, unknown> {
  date: string;
  dev: true;
}

/* ------------------------------------------- Phase 4 plan / merge payloads */

/**
 * A saved training plan — LWW by fold order: the LAST `plan_updated` in the
 * total `(ts, id)` order wins, and `data_cleared` resets the plan to `null`.
 * `plan: null` means "the built-in program", so a client that has never edited
 * anything (or that reset) is byte-identical to the original app.
 *
 * The document is carried WHOLE on purpose: a merge then has nothing to
 * reconcile field by field, and an old client that doesn't know the type simply
 * ignores the event (both reducers `default: break`).
 *
 * `plan` is deliberately typed as a plain JSON record rather than as `PlanDoc`:
 * this is the WIRE shape, and a payload that arrived from another device (or
 * from a newer app version) is untrusted until `normalizePlanDoc` has seen it.
 */
export interface PlanUpdatedPayload extends Record<string, unknown> {
  plan: Readonly<Record<string, unknown>> | null;
  /**
   * Bumped on every save (`max(local, incoming) + 1`). Bookkeeping only — the
   * authoritative order is the log's, never this number.
   */
  revision: number;
  /** ISO date of the save, like every other payload in the log. */
  date: string;
}

/**
 * A bookkeeping marker written when a foreign event set was folded into this
 * device's log (cloud pull, or an additive JSON import). DECLARED ONLY: it
 * changes no state, it exists so the history feed can explain a jump in XP.
 */
export interface DataMergedPayload extends Record<string, unknown> {
  source: 'sync' | 'json_import';
  /** How many events the merge actually added (already deduped by id). */
  added: number;
  /** Device the events came from, when they all share one. */
  from?: string;
}

/* ------------------------------------------------------------------ store */

export type Unsubscribe = () => void;

export interface DataStore {
  /** Current state snapshot (already migrated). */
  getState(): AppState;
  /** Persist a whole new state and notify subscribers. */
  save(next: AppState): void;
  /** Mutate the state in place and persist + notify. Returns the new state. */
  update(mutate: (draft: AppState) => void): AppState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: (state: AppState) => void): Unsubscribe;
  /**
   * Subscribe to every event the store APPENDS (including the synthetic
   * `data_cleared` of `clear()`). This is the sync engine's tap into the write
   * path — it never fires for events that arrived from elsewhere via
   * `replaceAll`, so a merged-in event can't be pushed back as if it were local.
   */
  subscribeEvents(listener: (ev: AppEvent) => void): Unsubscribe;
  /** Append one event to the log. Returns the stored event (id + ts filled). */
  append(type: EventType, payload?: Record<string, unknown>): AppEvent;
  /** The whole append-only log, oldest first. */
  getEvents(): readonly AppEvent[];
  /** Replace both state and log (JSON import, and every cloud merge). */
  replaceAll(state: AppState, events: readonly AppEvent[]): void;
  /** Wipe everything (keeps a `data_cleared` event in the fresh log). */
  clear(): void;
}
