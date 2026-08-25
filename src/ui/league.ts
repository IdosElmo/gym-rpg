/**
 * ui/league.ts — the 🏆 ליגה screen (view `LG`), third inner tab of the 🎮 hub.
 *
 * Stages 1 and 2 built the whole feature except the part a person can see: a
 * week's grade is a VALUE (`core/league.ts`), a closed week TRAVELS
 * (`core/leagueSync.ts` + `sync/engine.ts`), and this file is where those two
 * finally become a screen. It owns no rules: every number below is read from
 * `core/league.ts` or from the ledger the log folds to, and every write goes
 * through `core/game.ts`, i.e. through events.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * FOUR SECTIONS, IN THE ORDER A PERSON ASKS THE QUESTIONS
 * ───────────────────────────────────────────────────────────────────────────
 *   השבוע שלי     "how am I doing right now" — the LIVE week, its four
 *                 components as bars, the concrete numbers behind each of them
 *                 ("3 מתוך 4 ימים"), and the one thing that actually matters at
 *                 the end of it: whether this week mints its 🔵, or what is
 *                 still missing.
 *   המרוץ החודשי  "and am I ahead" — my month against the rival's, week by
 *                 week, in TWO COLUMNS DRAWN BY THE SAME BAR COMPONENT. That is
 *                 not a coincidence: stage 2 shaped `OpponentMonth.weeks` with
 *                 the same key and the same record type as `game.league.weeks`
 *                 precisely so one renderer could draw both sides and no second
 *                 scoreboard could ever drift from the first.
 *   חנות החודש    "what is it worth" — this month's pool, the purse, and the
 *                 spending flows.
 *   היסטוריה      "what has it been worth" — the months already settled.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE RIVAL, AND WHY THE SCREEN DOES NOT INVENT A SECOND NOTEBOOK
 * ───────────────────────────────────────────────────────────────────────────
 * The rival is picked BY HANDLE, exactly like a duel opponent, and reuses the
 * duel card's `rememberOpponent` list rather than keeping a league-only one.
 * A handle is ONE identity across the whole social surface (the ghost publishes
 * under it and the league rows carry the same string), so a second recent-list
 * would be a second vocabulary for the same two people — the person you duel is
 * the person you race. Concretely: `recent()[0]` is the rival the screen opens
 * on, so the common case (a two-person league) needs no typing at all.
 *
 * STALENESS is stated, never guessed, and follows stage 2's contract literally:
 *   * `stale: false`               — just read from the server: say nothing;
 *   * `stale: true`  + `fetchedAt` — cached rows: "נכון ל…" with the instant;
 *   * `stale: true`  + `null`      — nothing was ever read: show NOTHING at all
 *                                    (a zero would be a lie a dead connection
 *                                    must not be allowed to tell).
 *
 * THE 🛠 MARKER. A league row carries eleven numbers and a nickname — there is
 * no dev flag on it and this stage deliberately does not add a column. The flag
 * lives on the rival's GHOST (`GhostPayload.dev`), which is a row this app can
 * already read, so the screen fetches it alongside the month and marks the name
 * exactly the way the duel card does. If the row ever grows a flag of its own,
 * this fetch is the thing to delete.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SPENDING IS A SOCIAL CONTRACT, NOT A LOCK (stage 1's design note, honoured)
 * ───────────────────────────────────────────────────────────────────────────
 * `buildLeagueRedemption` deliberately does NOT check who won the month: that is
 * a cross-account fact, it depends on rows this log does not hold, and a fold
 * that has to converge from the event set alone cannot depend on the network.
 * So the rule lives HERE, as copy and as weight: the shop says
 * "הזוכה החודשי קונה — כבוד המשחק!", and while you are BEHIND the whole card is
 * de-emphasised (`.lg-shop.behind`) — dimmed, never disabled. Nothing is
 * blocked, because a lock that the other player's phone could bypass is not a
 * lock, and because the two people playing this share a kitchen.
 *
 * THE SHOP THEREFORE WORKS OFFLINE and while signed out: it spends a LOCAL
 * ledger (🔵 minted by this log's own closed weeks) on items from a pool that is
 * a pure function of the month. Only the RACE needs the cloud, and it is absent
 * — not disabled, absent — when there is no account behind the app, exactly like
 * the duel card.
 */

import { BALANCE } from '../core/balance.ts';
import {
  completeLeagueChallenge,
  gameOf,
  leagueContextOf,
  redeemLeagueReward,
  setLeagueChallenge,
} from '../core/game.ts';
import { checkHandle } from '../core/handle.ts';
import { normalizeGhost } from '../core/ghost.ts';
import {
  monthKeyOf,
  monthProgress,
  weekEndOf,
  weeksOfMonth,
  type LeagueSpendError,
  type WeekScore,
} from '../core/league.ts';
import { fmtDate, todayISO } from '../core/workout.ts';
import { leagueItemById, poolOfMonth, priceOf, type LeagueItem } from '../data/leaguePools.ts';
import type { AppEvent, DataStore, GameState, LeagueWeekRecord } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { fmtNum } from './stats.ts';
import { toast } from './toast.ts';

/* ------------------------------------------------------------------ ports */

/**
 * An opponent's month as `sync/engine.ts` hands it over — structurally its
 * `LeagueMonthView`, restated here so this screen imports nothing sync-related
 * (the same division `ui/ghost.ts` draws with `GhostLookupRow`).
 */
export interface LeagueMonthSnapshot {
  handle: string;
  monthKey: string;
  month: {
    /** weekKey -> record, keyed exactly like `game.league.weeks`. */
    weeks: Record<string, LeagueWeekRecord>;
    monthlyScore: number;
    coins: number;
    rejected: number;
  };
  /** ms epoch the rows were read from the server; `null` = never read. */
  fetchedAt: number | null;
  stale: boolean;
}

/** One row of the `ghosts` table — the only place a 🛠 flag exists today. */
export interface LeagueGhostRow {
  handle: string;
  payload: Record<string, unknown>;
}

/**
 * Everything the race needs from the cloud — and no more. `main.ts` implements
 * it over the sync engine; the DOM tests implement it over a `Map`. ABSENT (the
 * offline build) means the race section does not exist.
 */
export interface LeagueCloudDeps {
  /** Is there a live session? FALSE hides the race completely. */
  signedIn(): boolean;
  /** The name I publish under; `''` while it is not known yet. */
  myHandle(): string;
  /** Handles met recently, newest first — shared with the duel card. */
  recent(): readonly string[];
  /** Remember a handle for next time (the duel card's list, on purpose). */
  remember(handle: string): void;
  /** The cached month, with NO request — what a first paint draws. */
  cached(handle: string, monthKey: string): LeagueMonthSnapshot;
  /** Network, falling back to the cache. Never rejects (stage 2's contract). */
  load(handle: string, monthKey: string): Promise<LeagueMonthSnapshot>;
  /** Their ghost row, for the 🛠 marker. Optional: no fetch, no marker. */
  fetchGhost?(handle: string): Promise<LeagueGhostRow | null>;
}

export interface LeagueDeps {
  store: DataStore;
  /** ISO "today" — injectable so a test can pin the calendar. */
  today?: string;
  /** Re-render the whole screen (header + main) after a write. */
  rerender?: () => void;
  /** The cloud plumbing. Absent = the offline app: no race section at all. */
  cloud?: LeagueCloudDeps;
}

/* ------------------------------------------------------------- view state */

/** What is being confirmed, if anything. Pure view state — nothing is written. */
interface PendingSpend {
  kind: 'reward' | 'challenge';
  id: string;
  /** A Hebrew refusal from the last attempt, shown inside the sheet. */
  error: string;
}

/**
 * The rival lookup's own little state: who is in the field, who was loaded, and
 * what went wrong. Deliberately NOT persisted — a lookup is a question, not a
 * fact about the account (the same call `ui/battle.ts` makes for the duel card).
 */
interface RivalState {
  /** What is currently in the input. */
  query: string;
  /** The handle actually being raced; `''` = none. */
  handle: string;
  month: LeagueMonthSnapshot | null;
  /** `handle|monthKey` already asked for, so a repaint cannot loop. */
  asked: string;
  /** Their ghost carries a 🛠 dev flag. */
  dev: boolean;
  /** `handle` whose ghost was already looked up. */
  devAsked: string;
  loading: boolean;
  /** A Hebrew problem with the handle itself. */
  error: string;
}

const emptyRival = (): RivalState => ({
  query: '',
  handle: '',
  month: null,
  asked: '',
  dev: false,
  devAsked: '',
  loading: false,
  error: '',
});

/** Survives re-renders within a session, like the shop drawer on דמות. */
let rival: RivalState = emptyRival();
let pending: PendingSpend | null = null;

/** Test/boot helper: forget the open sheet and the looked-up rival. */
export function resetLeagueScreen(): void {
  rival = emptyRival();
  pending = null;
}

/* ------------------------------------------------------------------- copy */

/** Hebrew for every way a 🔵 spend can be refused. */
export const LEAGUE_ERROR_HE: Readonly<Record<LeagueSpendError, string>> = {
  unknown_item: 'הפריט הזה לא קיים בליגה.',
  wrong_month: 'הפריט הזה לא שייך לחנות של החודש הזה.',
  already_redeemed: 'הפריט הזה כבר נפדה החודש — אחד לכל חודש.',
  challenge_already_set: 'כבר בחרתם אתגר לחודש הזה — אחד בלבד.',
  no_challenge: 'לא בחרתם אתגר לחודש הזה.',
  already_completed: 'האתגר הזה כבר סומן כהושלם.',
  insufficient_coins: 'אין מספיק 🔵 — כל שבוע מלא מזכה במטבע אחד.',
};

/** Hebrew for every way a typed handle can be wrong. */
const HANDLE_ERROR_HE: Readonly<Record<'empty' | 'too_short' | 'too_long' | 'bad_chars', string>> = {
  empty: 'הקלידו את שם הלוחם של היריב.',
  too_short: 'שם לוחם הוא לפחות 3 תווים.',
  too_long: 'שם לוחם הוא עד 20 תווים.',
  bad_chars: 'שם לוחם יכול לכלול אותיות בעברית או באנגלית, ספרות ו־ _ . -',
};

/** The 🛠 tooltip, in the duel card's words — one meaning, one sentence. */
export const LEAGUE_DEV_HE = 'החשבון הזה קיבל הענקות במצב מפתח (לא רק אימונים אמיתיים)';

/** The social contract, in one line. It is the whole spending rule. */
export const LEAGUE_HONOR_HE = 'הזוכה החודשי קונה — כבוד המשחק!';

/** Shown while behind: dimmed, never blocked. */
export const LEAGUE_BEHIND_HE =
  'אתם מפגרים החודש. אפשר לפדות — האפליקציה לא חוסמת — אבל הכבוד אומר לחכות לסיום החודש.';

/** Nobody answers to that handle. */
export function leagueMissingHe(handle: string): string {
  return `לא נמצאו שבועות בשם "${handle}". בדקו את האיות — היריב רואה את השם שלו במסך ההגדרות.`;
}

/* ------------------------------------------------------------- the numbers */

type Comp = 'c' | 'q' | 'l' | 'p';

const COMPS: readonly Comp[] = ['c', 'q', 'l', 'p'] as const;

const COMP_HE: Readonly<Record<Comp, string>> = {
  c: 'עקביות',
  q: 'השלמה',
  l: 'עומס',
  p: 'שיאים',
};

function pct(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100);
}

/** A score for reading: one decimal, and never `82.0`. */
function fmtScore(n: number): string {
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * THE bar component — four labelled tracks from ONE `LeagueWeekRecord`.
 *
 * Both columns of the race are drawn by this function: my week and the rival's
 * week are the same record type, so they are the same picture, and a difference
 * between them can only ever be a difference in the numbers. `captions` fills in
 * the concrete explanation where the caller has one ("3 מתוך 4 ימים"); without
 * it every bar simply reads its own percentage.
 */
export function weekBars(rec: LeagueWeekRecord, captions: Partial<Record<Comp, string>> = {}): string {
  const rows = COMPS.map((k) => {
    const value = pct(rec[k]);
    return `
      <div class="lg-bar" data-comp="${k}">
        <span class="lb-k">${COMP_HE[k]}</span>
        <span class="lb-track"><i style="width:${value}%"></i></span>
        <span class="lb-v">${esc(captions[k] ?? `${value}%`)}</span>
      </div>`;
  }).join('');
  return `<div class="lg-bars">${rows}</div>`;
}

/** The live week's captions — the concrete numbers behind each component. */
function liveCaptions(week: WeekScore): Partial<Record<Comp, string>> {
  return {
    c: `${week.days} מתוך ${week.target} ימים`,
    q: `${week.completedSets} מתוך ${week.plannedSets} סטים`,
    l:
      week.baseline > 0
        ? `${fmtNum(week.volume)} מול בסיס ${fmtNum(week.baseline)}`
        : week.days > 0
          ? 'שבוע ראשון — אין בסיס להשוואה'
          : 'עדיין בלי עומס',
    p: `${week.prs} מתוך ${BALANCE.league.prTarget} שיאים`,
  };
}

/** A closed week's captions — what the ledger (or the rival's row) explains. */
function recordCaptions(rec: LeagueWeekRecord): Partial<Record<Comp, string>> {
  return {
    c: `${rec.days} ימי אימון`,
    l: `${fmtNum(rec.volume)} נק׳`,
    p: `${rec.prs} שיאים`,
  };
}

/**
 * The 🔵 gate, in Hebrew: earned, or exactly what is still missing.
 *
 * The rule is `C ≥ 1 && Q ≥ 0.8` (`core/league.ts`), so "missing" is at most two
 * concrete quantities — days and sets — and both are stated as counts rather
 * than as percentages, because a percentage is not something a person can go and
 * do this evening.
 */
export function coinGateHe(week: WeekScore): string {
  if (week.coin) return '🔵 השבוע הזה כבר מזכה במטבע ✓';
  const B = BALANCE.league;
  const needDays = Math.max(0, week.target - week.days);
  if (week.days === 0) {
    return `כדי לזכות ב־🔵 השבוע: עוד ${needDays} ימי אימון — עדיין לא התאמנתם.`;
  }
  const needSets = Math.max(0, Math.ceil(B.coinCompletion * week.plannedSets) - week.completedSets);
  const parts: string[] = [];
  if (needDays > 0) parts.push(needDays === 1 ? 'עוד יום אימון אחד' : `עוד ${needDays} ימי אימון`);
  if (needSets > 0) parts.push(needSets === 1 ? 'עוד סט אחד' : `עוד ${needSets} סטים`);
  if (parts.length === 0) return 'כדי לזכות ב־🔵 השבוע: השלימו את הסטים של הימים שנותרו.';
  return `כדי לזכות ב־🔵 השבוע: ${parts.join(' ו')}.`;
}

/**
 * The staleness line, per stage 2's contract — and `''` is a real answer twice:
 * fresh rows need no apology, and rows that were never read must not pretend to
 * be anything at all.
 */
export function staleLineHe(view: LeagueMonthSnapshot): string {
  if (!view.stale || view.fetchedAt === null) return '';
  const at = new Date(view.fetchedAt);
  const day = fmtDate(
    `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
  );
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return `נכון ל־${day}, ${time} — לא הצלחנו לרענן עכשיו.`;
}

/** "07.06–13.06" — one week, compactly. */
function weekRangeHe(weekKey: string): string {
  const from = fmtDate(weekKey).slice(0, 5);
  const to = fmtDate(weekEndOf(weekKey)).slice(0, 5);
  return `${from}–${to}`;
}

/** "אוגוסט 2026" — the pool already carries every month's Hebrew name. */
function monthHe(monthKey: string): string {
  return `${poolOfMonth(monthKey).he} ${monthKey.slice(0, 4)}`;
}

/**
 * `month|itemId` -> the ISO date it was redeemed on.
 *
 * The ledger stores WHAT was redeemed, never WHEN — a date is not needed to
 * decide anything, so stage 1 kept it out of the folded state. The screen wants
 * it anyway ("נפדה 14.08"), and the log has it: the payload of the very event
 * that wrote the ledger entry. Read, never folded.
 */
function redemptionDates(events: readonly AppEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const ev of events) {
    if (ev.type !== 'league_reward_redeemed' && ev.type !== 'league_challenge_completed') continue;
    const month = ev.payload['month'];
    const item = ev.type === 'league_reward_redeemed' ? ev.payload['itemId'] : ev.payload['challengeId'];
    const date = ev.payload['date'];
    if (typeof month !== 'string' || typeof item !== 'string' || typeof date !== 'string') continue;
    const key = `${month}|${item}`;
    if (!out.has(key)) out.set(key, date);
  }
  return out;
}

/* ----------------------------------------------------------- the sections */

/** השבוע שלי — the live week, graded as it stands right now. */
function liveCard(week: WeekScore): string {
  return `
  <section class="lg-card lg-live" aria-label="השבוע שלי">
    <h3 class="lg-title">השבוע שלי <span class="lg-sub">${esc(weekRangeHe(week.weekKey))}</span></h3>
    <div class="lg-score" data-score="${week.score}">
      <b>${fmtScore(week.score)}</b><span>נקודות · מתוך 100</span>
    </div>
    ${weekBars(week, liveCaptions(week))}
    <p class="lg-coin ${week.coin ? 'ok' : 'warn'}" data-coin="${week.coin ? 'earned' : 'missing'}">
      ${esc(coinGateHe(week))}
    </p>
    <p class="lg-note dim">השבוע נסגר במוצאי שבת ונרשם ליומן. עד אז הציון זז עם כל סט.</p>
  </section>`;
}

/** One cell of the race table: a score with its four bars, or a dash. */
function raceCell(rec: LeagueWeekRecord | null, live: boolean): string {
  if (!rec) return '<span class="lg-empty" aria-label="אין שבוע">—</span>';
  return `
    <span class="lg-cell-score">${fmtScore(rec.score)}${rec.coin ? ' 🔵' : ''}</span>
    ${live ? '<span class="lg-livechip">בהתהוות</span>' : ''}
    ${weekBars(rec, recordCaptions(rec))}`;
}

/** Who is ahead, in one line. */
function leaderHe(mine: number, theirs: number, name: string): string {
  const diff = Math.round(Math.abs(mine - theirs) * 10) / 10;
  if (diff === 0) return `תיקו — ${fmtScore(mine)} נקודות לכל אחד.`;
  return mine > theirs
    ? `אתם מובילים ב־${fmtScore(diff)} נקודות.`
    : `${name} מוביל/ה ב־${fmtScore(diff)} נקודות.`;
}

/**
 * המרוץ החודשי — my month against the rival's, week by week.
 *
 * `''` when there is no account behind the app: absent, not disabled. Somebody
 * using the offline app must never be shown a cloud feature they cannot have.
 */
function raceCard(game: GameState, month: string, live: WeekScore, mineTotal: number, cloud?: LeagueCloudDeps): string {
  if (!cloud || !cloud.signedIn()) return '';

  const view = rival.month;
  const theirWeeks = view?.month.weeks ?? {};
  const theirTotal = view?.month.monthlyScore ?? 0;
  const list = cloud.recent().map((h) => `<option value="${esc(h)}"></option>`).join('');
  const myHandle = cloud.myHandle();

  // The month is already on the title; the head answers the other question a
  // person has here — "what name do I read out to them".
  const head = myHandle
    ? `<div class="lg-race-head"><span class="lg-chip">🏁 אתם: <b>${esc(myHandle)}</b></span></div>`
    : '';

  const search = `
    <div class="lg-search">
      <label class="lg-label" for="lgHandle">שם הלוחם של היריב/ה</label>
      <div class="lg-row">
        <input class="lg-input" id="lgHandle" type="text" inputmode="text" autocomplete="off"
          list="lgRivals" maxlength="20" value="${esc(rival.query)}" placeholder="לדוגמה: יוסי"
          aria-label="שם הלוחם של היריב">
        <button class="lg-find" id="lgFind" type="button" ${rival.loading ? 'disabled' : ''}>
          ${rival.loading ? '⏳ טוען…' : '🔍 חיפוש'}
        </button>
      </div>
      <datalist id="lgRivals">${list}</datalist>
    </div>`;

  if (rival.error) {
    return `
    <section class="lg-card lg-race" data-state="missing" aria-label="המרוץ החודשי">
      <h3 class="lg-title">המרוץ החודשי <span class="lg-sub">${esc(monthHe(month))}</span></h3>
      ${head}${search}
      <p class="lg-note warn">${esc(rival.error)}</p>
    </section>`;
  }

  if (!rival.handle || !view) {
    return `
    <section class="lg-card lg-race" data-state="idle" aria-label="המרוץ החודשי">
      <h3 class="lg-title">המרוץ החודשי <span class="lg-sub">${esc(monthHe(month))}</span></h3>
      ${head}${search}
      <p class="lg-note">בקשו מהיריב/ה את "שם הלוחם" (מסך ההגדרות), הקלידו אותו כאן — והחודש שלכם יעמוד מול החודש שלו/ה, שבוע מול שבוע.</p>
    </section>`;
  }

  const liveKey = live.weekKey;
  const rows = weeksOfMonth(month)
    .map((week) => {
      const mine = game.league.weeks[week] ?? (week === liveKey ? (live as LeagueWeekRecord) : null);
      const theirs = theirWeeks[week] ?? null;
      return `
      <div class="lg-week" data-week="${week}">
        <div class="lg-wk">${esc(weekRangeHe(week))}</div>
        <div class="lg-cell mine" data-side="mine">${raceCell(mine, week === liveKey && !game.league.weeks[week])}</div>
        <div class="lg-cell theirs" data-side="theirs">${raceCell(theirs, false)}</div>
      </div>`;
    })
    .join('');

  const stale = staleLineHe(view);
  return `
  <section class="lg-card lg-race" data-state="ready" aria-label="המרוץ החודשי">
    <h3 class="lg-title">המרוץ החודשי <span class="lg-sub">${esc(monthHe(month))}</span></h3>
    ${head}${search}
    <div class="lg-cols">
      <div class="lg-colhead">
        <span class="lg-wk"></span>
        <span class="lg-cell mine">אני</span>
        <span class="lg-cell theirs">${esc(rival.handle)}${
          rival.dev
            ? ` <span class="lg-dev" title="${esc(LEAGUE_DEV_HE)}" aria-label="${esc(LEAGUE_DEV_HE)}">🛠</span>`
            : ''
        }</span>
      </div>
      ${rows}
      <div class="lg-week total" data-week="total">
        <div class="lg-wk">סה״כ</div>
        <div class="lg-cell mine" data-side="mine"><b class="lg-total" data-total="mine">${fmtScore(mineTotal)}</b></div>
        <div class="lg-cell theirs" data-side="theirs"><b class="lg-total" data-total="theirs">${fmtScore(theirTotal)}</b></div>
      </div>
    </div>
    <p class="lg-leader ${mineTotal >= theirTotal ? 'ok' : 'warn'}">${esc(leaderHe(mineTotal, theirTotal, rival.handle))}</p>
    ${stale ? `<p class="lg-stale" data-stale="1">${esc(stale)}</p>` : ''}
  </section>`;
}

/**
 * One pool item — a gift, an experience or a challenge.
 *
 * The button is never `disabled`, whatever the purse says: the refusal belongs
 * to the confirmation sheet, where it can be a Hebrew sentence rather than a
 * greyed-out mystery.
 */
function itemCard(item: LeagueItem, opts: { claimedOn: string | null; action: 'redeem' | 'stake' }): string {
  const price = priceOf(item.kind);
  const claimed = opts.claimedOn !== null;
  return `
    <div class="lg-item" data-item="${esc(item.id)}" data-kind="${item.kind}"
      data-state="${claimed ? 'claimed' : 'open'}">
      <div class="li-head"><span class="li-emoji" aria-hidden="true">${item.emoji}</span><b>${esc(item.he)}</b></div>
      <p class="li-detail">${esc(item.detail)}</p>
      <div class="li-foot">
        <span class="li-price">🔵 ${price}${item.bonus > 0 ? ` · בונוס ${item.bonus} 🔵` : ''}</span>
        ${
          claimed
            ? `<span class="li-claimed" data-claimed="1">✓ ${item.kind === 'challenge' ? 'הושלם' : 'נפדה'} ${esc(
                fmtDate(opts.claimedOn as string),
              )}</span>`
            : `<button class="lg-btn li-btn" type="button" data-${opts.action}="${esc(item.id)}">${
                item.kind === 'challenge' ? `⚔️ הימור · 🔵 ${price}` : `פדיון · 🔵 ${price}`
              }</button>`
        }
      </div>
    </div>`;
}

/** The confirmation sheet — nothing is written until it is confirmed. */
function spendSheet(game: GameState, month: string): string {
  if (!pending) return '';
  const pool = poolOfMonth(month);
  const item = [...pool.rewards, ...pool.challenges].find((i) => i.id === pending?.id);
  if (!item) return '';
  const cost = priceOf(item.kind);
  const coins = game.league.coins;
  const missing = Math.max(0, cost - coins);
  return `
    <div class="lg-sheet" id="lgSheet" role="group" aria-label="אישור הוצאה">
      <div class="ls-head"><b>${item.emoji} ${esc(item.he)}</b><span>${esc(item.detail)}</span></div>
      <p class="ls-price">מחיר: <b>🔵 ${cost}</b> · יש לכם: <b>🔵 ${coins}</b>${
        missing > 0 ? ` · <span class="warn">חסרים ${missing}</span>` : ''
      }</p>
      ${
        item.kind === 'challenge'
          ? `<p class="lg-note dim">הימור: ${cost} 🔵 עכשיו, ${item.bonus} 🔵 בחזרה כשמסמנים "השלמתי". אתגר אחד לחודש.</p>`
          : `<p class="lg-note dim">${esc(LEAGUE_HONOR_HE)} הפדיון נרשם ביומן ולא ניתן לביטול.</p>`
      }
      ${pending.error ? `<p class="lg-error" data-error="1">${esc(pending.error)}</p>` : ''}
      <div class="ls-actions">
        <button class="lg-btn buy" type="button" data-confirm="1">${
          item.kind === 'challenge' ? '⚔️ אני מהמר/ת' : '🔵 פדיון'
        }</button>
        <button class="lg-btn off" type="button" data-cancel="1">ביטול</button>
      </div>
    </div>`;
}

/** חנות החודש — the pool, the purse and the two spending flows. */
function shopCard(game: GameState, month: string, behind: boolean, dates: Map<string, string>): string {
  const pool = poolOfMonth(month);
  const league = game.league;
  const stake = league.challenges[month] ?? null;
  // By id, not by "is it in this month's pool": the ledger is the truth about
  // what was staked, and an item whose month key was edited in the data must
  // still show up as the thing this account is holding.
  const staked = stake ? leagueItemById(stake.challengeId) : null;
  const completed = stake ? league.completions[`${month}|${stake.challengeId}`] : undefined;

  const rewards = pool.rewards
    .map((item) =>
      itemCard(item, {
        claimedOn: league.redemptions[`${month}|${item.id}`] ? (dates.get(`${month}|${item.id}`) ?? month) : null,
        action: 'redeem',
      }),
    )
    .join('');

  const challenges = staked
    ? `
      <div class="lg-item staked" data-item="${esc(staked.id)}" data-kind="challenge"
        data-state="${completed === undefined ? 'staked' : 'done'}">
        <div class="li-head"><span class="li-emoji" aria-hidden="true">⚔️</span><b>${esc(staked.he)}</b></div>
        <p class="li-detail">${esc(staked.detail)}</p>
        <div class="li-foot">
          <span class="li-price">הימור 🔵 ${stake?.cost ?? priceOf('challenge')} · בונוס ${staked.bonus} 🔵</span>
          ${
            completed === undefined
              ? '<button class="lg-btn li-btn done" type="button" data-complete="1">השלמתי ✓</button>'
              : `<span class="li-claimed" data-claimed="1">✓ הושלם${
                  dates.has(`${month}|${staked.id}`) ? ` ${esc(fmtDate(dates.get(`${month}|${staked.id}`) as string))}` : ''
                } · +${completed} 🔵</span>`
          }
        </div>
      </div>`
    : pool.challenges.map((item) => itemCard(item, { claimedOn: null, action: 'stake' })).join('');

  return `
  <section class="lg-card lg-shop ${behind ? 'behind' : ''}" data-behind="${behind ? '1' : '0'}"
    aria-label="חנות החודש">
    <h3 class="lg-title">חנות החודש <span class="lg-sub">${esc(monthHe(month))}</span></h3>
    <div class="lg-purse">
      <b data-purse="1">🔵 ${league.coins}</b>
      <span>מטבעות ליגה · ${league.coinsEarned} נצברו · ${league.coinsSpent} הוצאו</span>
    </div>
    <p class="lg-honor" data-honor="1">${esc(LEAGUE_HONOR_HE)}</p>
    ${behind ? `<p class="lg-note warn" data-behind-note="1">${esc(LEAGUE_BEHIND_HE)}</p>` : ''}
    ${spendSheet(game, month)}
    <h4 class="lg-sub-title">🎁 מתנות · 🌄 חוויות</h4>
    <div class="lg-pool">${rewards}</div>
    <h4 class="lg-sub-title">⚔️ אתגר החודש <span class="lg-sub">${
      staked ? 'הימור פעיל' : 'אחד לחודש, מוחזר עם בונוס'
    }</span></h4>
    <div class="lg-pool challenges">${challenges}</div>
  </section>`;
}

/** היסטוריה — the months already settled, newest first. */
function historyCard(game: GameState, month: string): string {
  const months = Object.values(game.league.months)
    .filter((m) => m.month !== month)
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  const body =
    months.length === 0
      ? '<p class="lg-note dim">עוד אין חודשים סגורים. החודש הראשון ייכנס לכאן ברגע שיתחלף.</p>'
      : `<ul class="lg-months">${months
          .map(
            (m) => `
        <li class="lg-month" data-month="${esc(m.month)}">
          <span class="lm-name">${esc(monthHe(m.month))}</span>
          <span class="lm-score"><b>${fmtScore(m.score)}</b> נק׳</span>
          <span class="lm-weeks">${m.weeks} שבועות</span>
          <span class="lm-coins">🔵 ${m.coins}</span>
        </li>`,
          )
          .join('')}</ul>`;

  return `
  <section class="lg-card lg-history" aria-label="היסטוריית הליגה">
    <h3 class="lg-title">היסטוריה <span class="lg-sub">חודשים שנסגרו</span></h3>
    ${body}
  </section>`;
}

/* ------------------------------------------------------------------ paint */

/** The whole screen as one string — pure, so a test can read it without a DOM. */
export function leagueHtml(deps: LeagueDeps, today: string): string {
  const game = gameOf(deps.store);
  const ctx = leagueContextOf(deps.store);
  const progress = monthProgress(ctx, game.league, today);
  const month = monthKeyOf(today);
  const dates = redemptionDates(deps.store.getEvents());
  const theirTotal = rival.month?.month.monthlyScore ?? 0;
  // "Behind" is only knowable with a rival on screen; without one nothing is
  // de-emphasised, because nobody has been beaten.
  const behind = rival.month !== null && theirTotal > progress.total;

  return `
  ${liveCard(progress.liveWeek)}
  ${raceCard(game, month, progress.liveWeek, progress.total, deps.cloud)}
  ${shopCard(game, month, behind, dates)}
  ${historyCard(game, month)}`;
}

export function renderLeague(main: HTMLElement, deps: LeagueDeps): void {
  const today = deps.today ?? todayISO();
  main.innerHTML = leagueHtml(deps, today);
  wire(main, deps, today);
  void ensureRival(main, deps, monthKeyOf(today));
}

/** Repaint in place — the screen's own refresh, or the shell's. */
function refresh(main: HTMLElement, deps: LeagueDeps): void {
  if (deps.rerender) deps.rerender();
  else renderLeague(main, deps);
}

/* ----------------------------------------------------------------- wiring */

function wire(main: HTMLElement, deps: LeagueDeps, today: string): void {
  const month = monthKeyOf(today);
  const again = (): void => refresh(main, deps);

  /* ---- the rival lookup (only present while signed in) ---- */
  const input = main.querySelector<HTMLInputElement>('#lgHandle');
  input?.addEventListener('input', () => {
    // Typing invalidates the loaded rival: the table must never be labelled
    // with somebody other than the name in the field.
    rival.query = input.value;
    rival.error = '';
  });
  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void findRival(main, deps, input.value, month);
  });
  main.querySelector<HTMLButtonElement>('#lgFind')?.addEventListener('click', () => {
    void findRival(main, deps, input?.value ?? rival.query, month);
  });

  /* ---- the shop: open a sheet, never spend on the first tap ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-redeem]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['redeem'];
      if (!id) return;
      pending = { kind: 'reward', id, error: '' };
      again();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-stake]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['stake'];
      if (!id) return;
      pending = { kind: 'challenge', id, error: '' };
      again();
    });
  });
  main.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', () => {
    pending = null;
    again();
  });
  main.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click', () => {
    const p = pending;
    if (!p) return;
    const result =
      p.kind === 'reward'
        ? redeemLeagueReward(deps.store, month, p.id)
        : setLeagueChallenge(deps.store, month, p.id);
    if (!result.ok) {
      // A refusal never reached the log (`core/league.ts` decides first), so the
      // only thing to do is say why — inside the sheet, and once as a toast.
      const he = LEAGUE_ERROR_HE[result.error ?? 'unknown_item'];
      pending = { ...p, error: he };
      toast(he);
      again();
      return;
    }
    pending = null;
    toast(p.kind === 'reward' ? `נפדה! 🔵 ${result.cost} ירדו מהארנק.` : `ההימור נרשם — בהצלחה! ⚔️`);
    again();
  });

  /* ---- the staked challenge: self-reported, and it PAYS ---- */
  main.querySelector<HTMLButtonElement>('[data-complete]')?.addEventListener('click', () => {
    const result = completeLeagueChallenge(deps.store, month);
    if (!result.ok) {
      toast(LEAGUE_ERROR_HE[result.error ?? 'no_challenge']);
      return;
    }
    toast('כל הכבוד! הבונוס נכנס לארנק 🔵');
    again();
  });
}

/* ------------------------------------------------------------- the rival */

/**
 * Open on the rival we already know, and refresh them from the network ONCE per
 * (handle, month) per mount.
 *
 * The cached copy is painted first and without a request (`cached`), so the
 * table is on screen before anything touches the wire; the refresh then either
 * confirms it (`stale: false`) or leaves the cached rows with their "נכון ל…"
 * line. `asked` is set BEFORE the await, which is what stops a repaint from
 * re-entering this function for ever.
 */
async function ensureRival(main: HTMLElement, deps: LeagueDeps, month: string): Promise<void> {
  const cloud = deps.cloud;
  if (!cloud || !cloud.signedIn() || rival.error) return;

  if (!rival.handle) {
    const first = cloud.recent()[0];
    if (!first) return;
    rival = { ...rival, handle: first, query: rival.query || first, month: cloud.cached(first, month) };
  }
  const key = `${rival.handle}|${month}`;
  if (rival.asked === key || rival.loading) return;

  rival = { ...rival, asked: key, loading: true };
  const handle = rival.handle;
  const view = await cloud.load(handle, month);
  if (rival.handle !== handle) return; // the user moved on while we waited
  // NOTHING KNOWN is not the same as "they scored zero": a month with no
  // accepted week that was never read from the server (offline, sync dark)
  // leaves the card on its invitation rather than drawing an empty table with
  // somebody's name over it.
  const known = Object.keys(view.month.weeks).length > 0 || view.fetchedAt !== null;
  rival = { ...rival, loading: false, month: known ? view : null };
  await loadDev(cloud, handle);
  refresh(main, deps);
}

/** Their ghost's 🛠 flag — one fetch per handle, and failure is silent. */
async function loadDev(cloud: LeagueCloudDeps, handle: string): Promise<void> {
  if (!cloud.fetchGhost || rival.devAsked === handle) return;
  rival = { ...rival, devAsked: handle };
  try {
    const row = await cloud.fetchGhost(handle);
    const ghost = row ? normalizeGhost(row.payload) : null;
    if (rival.handle === handle) rival = { ...rival, dev: ghost?.dev === true };
  } catch {
    /* no ghost, no marker — the race itself is unaffected */
  }
}

/**
 * Look a rival up by handle.
 *
 * The handle is validated before anything is requested, and a month that comes
 * back with no accepted week at all is reported as "nobody there" rather than as
 * a zero — the same courtesy the duel card extends to a typo.
 */
async function findRival(main: HTMLElement, deps: LeagueDeps, raw: string, month: string): Promise<void> {
  const cloud = deps.cloud;
  if (!cloud) return;
  const check = checkHandle(raw);
  if (!check.ok) {
    rival = { ...rival, query: raw, handle: '', month: null, error: HANDLE_ERROR_HE[check.error ?? 'empty'] };
    refresh(main, deps);
    return;
  }
  if (check.handle === cloud.myHandle()) {
    rival = { ...rival, query: raw, handle: '', month: null, error: 'זה אתם — חפשו את השם של מישהו אחר.' };
    refresh(main, deps);
    return;
  }

  rival = {
    ...rival,
    query: check.handle,
    handle: check.handle,
    month: null,
    error: '',
    loading: true,
    asked: `${check.handle}|${month}`,
    dev: false,
    devAsked: '',
  };
  refresh(main, deps);

  const view = await cloud.load(check.handle, month);
  if (rival.handle !== check.handle) return;
  const empty = Object.keys(view.month.weeks).length === 0;
  if (empty && view.fetchedAt === null) {
    rival = { ...rival, loading: false, month: null, error: leagueMissingHe(check.handle) };
    refresh(main, deps);
    return;
  }
  cloud.remember(check.handle);
  rival = { ...rival, loading: false, month: view };
  await loadDev(cloud, check.handle);
  refresh(main, deps);
}
