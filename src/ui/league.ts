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
 * The rival is picked BY HANDLE, exactly like a duel opponent — and only ever
 * BY THE PERSON: typed into the field, or accepted from an invitation link
 * (`#rival=<handle>`, see `parseRivalHash`). The screen never picks one on its
 * own. Somebody you once duelled is a SUGGESTION (the duel card's
 * `rememberOpponent` list feeds the field's datalist), not a rival: a stranger
 * whose ghost you fought has not agreed to race you, and a race you did not
 * choose is a leaderboard you did not ask to be on.
 *
 * The choice is remembered on this device (`UiState.rival`, never an event), so
 * the screen reopens on it after a reload or a month change. ONE migration: a
 * device that has no choice recorded yet but has already RACED someone — their
 * league rows for this month are in the local cache, which before this rule only
 * the old open-on-`recent()[0]` behaviour could have put there — keeps that
 * rival, so an existing two-person league opens exactly as it did.
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
 * THAT CONTRACT IS THE COUPLE'S. The prize mode (`prizeModeOf`, a device
 * preference with a toggle on the shop card) picks whose prizes are on offer:
 * the COUPLE's pools carry the winner-buys line and the behind-dimming; the
 * PERSONAL pools are rewards you buy yourself, so they carry neither — being
 * behind a rival does not make a massage you earned by training any less yours.
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
  prizeModeOf,
  weekEndOf,
  weeksOfMonth,
  type LeagueSpendError,
  type WeekScore,
} from '../core/league.ts';
import { fmtDate, todayISO } from '../core/workout.ts';
import {
  isPrizeMode,
  leagueItemById,
  poolOfMonth,
  priceOf,
  type LeagueItem,
  type PrizeMode,
} from '../data/leaguePools.ts';
import { leagueItemDetail, leagueItemName } from '../i18n/leagueText.ts';
import type { AppEvent, DataStore, GameState, LeagueWeekRecord } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { fmtNum } from './stats.ts';
import { toast } from './toast.ts';
import { locale, tr } from '../i18n/locale.ts';
import { fmtDayMonth } from '../i18n/format.ts';
import { league as M } from '../i18n/messages/league.ts';
import type { HandleError } from '../core/handle.ts';

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
  /** The refusal of the last attempt, shown inside the sheet (worded at paint time). */
  error: LeagueSpendError | null;
}

/**
 * What went wrong with the rival lookup — kept as a REASON and worded at paint
 * time, so a language switch rewords it too.
 */
type RivalError =
  | { kind: 'handle'; code: HandleError }
  | { kind: 'self' }
  | { kind: 'missing'; handle: string };

function rivalErrorText(e: RivalError): string {
  const m = tr(M);
  if (e.kind === 'handle') return m.handleErrors[e.code];
  if (e.kind === 'self') return m.self;
  return m.missing(e.handle);
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
  /** A problem with the handle itself; `null` = none. */
  error: RivalError | null;
}

const emptyRival = (): RivalState => ({
  query: '',
  handle: '',
  month: null,
  asked: '',
  dev: false,
  devAsked: '',
  loading: false,
  error: null,
});

/** Survives re-renders within a session, like the shop drawer on דמות. */
let rival: RivalState = emptyRival();
let pending: PendingSpend | null = null;
/**
 * The invitation text, once the 📨 button found neither a share sheet nor a
 * clipboard it could trust — shown in a selectable field so it can always be
 * copied by hand. `null` = not shown.
 */
let inviteText: string | null = null;

/** Test/boot helper: forget the open sheet, the looked-up rival and the invite field. */
export function resetLeagueScreen(): void {
  rival = emptyRival();
  pending = null;
  inviteText = null;
}

/* ------------------------------------------------------------ invitations */

/** The URL-hash key an invitation link carries: `#rival=<handle>`. */
export const RIVAL_HASH_KEY = 'rival';

/**
 * The handle an invitation link names, or `null` when the hash is not one.
 *
 * Pure. Accepts `#rival=<handle>` (and the same key among other `&`-separated
 * hash parameters), percent-decoded and trimmed; anything else — an empty
 * value, a handle longer than any warrior name, an OAuth callback's
 * `#access_token=…` — is not an invitation. The handle is NOT validated here:
 * accepting it goes through `findRival`, which checks it exactly like a typed
 * one (well-formed, not yourself, somebody actually there).
 */
export function parseRivalHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  let value: string | null;
  try {
    value = new URLSearchParams(raw).get(RIVAL_HASH_KEY);
  } catch {
    return null;
  }
  const handle = (value ?? '').trim();
  return handle.length > 0 && handle.length <= 40 ? handle : null;
}

/** The link that invites somebody to race `handle`: this app's own address + `#rival=`. */
export function inviteLink(origin: string, pathname: string, handle: string): string {
  return `${origin}${pathname}#${RIVAL_HASH_KEY}=${encodeURIComponent(handle)}`;
}

/** The slice of `window` the invitation wiring needs — a test passes a fake. */
export interface InviteWindow {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState(data: unknown, unused: string, url?: string): void };
}

/**
 * The app was opened with an invitation: remember it in the store, route to
 * 🏆 ליגה, and take the hash out of the address bar (`history.replaceState`, so
 * neither a reload nor the back button replays it). The invitation is kept in
 * `UiState.invite` rather than in the URL so it survives a sign-in redirect;
 * the league screen asks before anything is decided. Returns whether there was
 * one.
 */
export function captureRivalInvite(store: DataStore, win: InviteWindow): boolean {
  const handle = parseRivalHash(win.location.hash);
  if (!handle) return false;
  store.update((d) => {
    d.ui.invite = handle;
    d.ui.view = 'LG';
  });
  try {
    win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}`);
  } catch {
    /* a host without history: the invitation is in the store either way */
  }
  return true;
}

/** The prize mode the shop is showing on this device. */
function modeOf(store: DataStore): PrizeMode {
  return prizeModeOf(store.getState());
}

/* ------------------------------------------------------------------- copy */

/*
 * The Hebrew originals stay exported for the tests that pin them; the screen
 * itself reads `tr(M)` at paint time.
 */

/** Hebrew for every way a 🔵 spend can be refused. */
export const LEAGUE_ERROR_HE: Readonly<Record<LeagueSpendError, string>> = M.he.errors;

/** The 🛠 tooltip, in the duel card's words — one meaning, one sentence. */
export const LEAGUE_DEV_HE = M.he.dev;

/** The social contract, in one line. It is the whole spending rule. */
export const LEAGUE_HONOR_HE = M.he.honor;

/** Shown while behind: dimmed, never blocked. */
export const LEAGUE_BEHIND_HE = M.he.behind;

/** Nobody answers to that handle (in the current language). */
export function leagueMissingHe(handle: string): string {
  return tr(M).missing(handle);
}

/* ------------------------------------------------------------- the numbers */

type Comp = 'c' | 'q' | 'l' | 'p';

const COMPS: readonly Comp[] = ['c', 'q', 'l', 'p'] as const;

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
  const names = tr(M).comp;
  const rows = COMPS.map((k) => {
    const value = pct(rec[k]);
    return `
      <div class="lg-bar" data-comp="${k}">
        <span class="lb-k">${names[k]}</span>
        <span class="lb-track"><i style="width:${value}%"></i></span>
        <span class="lb-v">${esc(captions[k] ?? `${value}%`)}</span>
      </div>`;
  }).join('');
  return `<div class="lg-bars">${rows}</div>`;
}

/** The live week's captions — the concrete numbers behind each component. */
function liveCaptions(week: WeekScore): Partial<Record<Comp, string>> {
  const m = tr(M).live;
  return {
    c: m.days(week.days, week.target),
    q: m.sets(week.completedSets, week.plannedSets),
    l:
      week.baseline > 0
        ? m.load(fmtNum(week.volume), fmtNum(week.baseline))
        : week.days > 0
          ? m.firstWeek
          : m.noLoad,
    p: m.prs(week.prs, BALANCE.league.prTarget),
  };
}

/** A closed week's captions — what the ledger (or the rival's row) explains. */
function recordCaptions(rec: LeagueWeekRecord): Partial<Record<Comp, string>> {
  const m = tr(M).record;
  return {
    c: m.days(rec.days),
    l: m.points(fmtNum(rec.volume)),
    p: m.prs(rec.prs),
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
  const m = tr(M).gate;
  if (week.coin) return m.earned;
  const B = BALANCE.league;
  const needDays = Math.max(0, week.target - week.days);
  if (week.days === 0) {
    return m.notStarted(needDays);
  }
  const needSets = Math.max(0, Math.ceil(B.coinCompletion * week.plannedSets) - week.completedSets);
  const parts: string[] = [];
  if (needDays > 0) parts.push(m.days(needDays));
  if (needSets > 0) parts.push(m.sets(needSets));
  if (parts.length === 0) return m.finish;
  return m.need(parts);
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
  return tr(M).stale(day, time);
}

/** "07.06–13.06" / "Jun 7–Jun 13" — one week, compactly. */
function weekRangeHe(weekKey: string): string {
  if (locale() !== 'he') return `${fmtDayMonth(weekKey)}–${fmtDayMonth(weekEndOf(weekKey))}`;
  const from = fmtDate(weekKey).slice(0, 5);
  const to = fmtDate(weekEndOf(weekKey)).slice(0, 5);
  return `${from}–${to}`;
}

/**
 * "אוגוסט 2026" — the pool already carries every month's Hebrew name; other
 * languages read theirs from the catalog ("August 2026").
 */
function monthHe(monthKey: string): string {
  const he = poolOfMonth(monthKey).he;
  const name = locale() === 'he' ? he : (tr(M).months[Number(monthKey.slice(5, 7)) - 1] ?? he);
  return `${name} ${monthKey.slice(0, 4)}`;
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
  const m = tr(M).liveCard;
  return `
  <section class="lg-card lg-live" aria-label="${esc(m.title)}">
    <h3 class="lg-title">${m.title} <span class="lg-sub">${esc(weekRangeHe(week.weekKey))}</span></h3>
    <div class="lg-score" data-score="${week.score}">
      <b>${fmtScore(week.score)}</b><span>${m.points}</span>
    </div>
    ${weekBars(week, liveCaptions(week))}
    <p class="lg-coin ${week.coin ? 'ok' : 'warn'}" data-coin="${week.coin ? 'earned' : 'missing'}">
      ${esc(coinGateHe(week))}
    </p>
    <p class="lg-note dim">${m.note}</p>
  </section>`;
}

/** One cell of the race table: a score with its four bars, or a dash. */
function raceCell(rec: LeagueWeekRecord | null, live: boolean): string {
  const m = tr(M);
  if (!rec) return `<span class="lg-empty" aria-label="${esc(m.noWeek)}">—</span>`;
  return `
    <span class="lg-cell-score">${fmtScore(rec.score)}${rec.coin ? ' 🔵' : ''}</span>
    ${live ? `<span class="lg-livechip">${m.inProgress}</span>` : ''}
    ${weekBars(rec, recordCaptions(rec))}`;
}

/** Who is ahead, in one line. */
function leaderHe(mine: number, theirs: number, name: string): string {
  const m = tr(M).leader;
  const diff = Math.round(Math.abs(mine - theirs) * 10) / 10;
  if (diff === 0) return m.tie(fmtScore(mine));
  return mine > theirs ? m.mine(fmtScore(diff)) : m.theirs(name, fmtScore(diff));
}

/** An invitation that opened the app, waiting for a yes or a no. */
function inviteAsk(handle: string): string {
  const m = tr(M).invite;
  return `
    <div class="lg-invite-ask" data-invite-ask="${esc(handle)}" role="group" aria-label="${esc(m.received)}">
      <p class="lg-invite-k">${m.received}</p>
      <p class="lg-invite-q">${m.ask(esc(handle))}</p>
      <div class="ls-actions">
        <button class="lg-btn buy" type="button" data-invite-accept="1">${m.accept}</button>
        <button class="lg-btn off" type="button" data-invite-decline="1">${m.decline}</button>
      </div>
    </div>`;
}

/** The empty race's invitation: one button, and the text by hand when needed. */
function inviteCall(): string {
  const m = tr(M).invite;
  return `
    <div class="lg-invite" data-invite="1">
      <p class="lg-note">${m.lead}</p>
      <button class="lg-btn buy lg-invite-btn" id="lgInvite" type="button">${m.button}</button>
      ${
        inviteText !== null
          ? `<label class="lg-label lg-invite-label" for="lgInviteText">${m.fallbackLabel}</label>
      <textarea class="lg-input lg-invite-text" id="lgInviteText" rows="3" readonly>${esc(inviteText)}</textarea>`
          : ''
      }
    </div>`;
}

/**
 * המרוץ החודשי — my month against the rival's, week by week.
 *
 * `''` when there is no account behind the app: absent, not disabled. Somebody
 * using the offline app must never be shown a cloud feature they cannot have.
 *
 * THE TOTAL COMPARES LIKE WITH LIKE — closed weeks only, on BOTH sides, which is
 * the one rule this row cannot bend. A rival's column is built from published
 * rows, and only a CLOSED week is ever published (`publishableWeeks`), so their
 * week in progress is not merely unknown, it is unknowable. Adding my own live
 * week to my own total therefore does not make the race more current, it makes
 * it wrong: it awards me points for a week they are also training and cannot
 * report. The live week keeps its row (marked בהתהוות, moving with every set)
 * and its contribution is stated NEXT TO the total — never inside it — so a
 * person can see both what is settled and what is still in play.
 */
function raceCard(
  game: GameState,
  month: string,
  progress: { liveWeek: WeekScore; closed: number; live: number },
  invite: string,
  cloud?: LeagueCloudDeps,
): string {
  if (!cloud) return '';
  // Signed out, the race stays ABSENT — except for an invitation somebody
  // opened: it cannot be accepted without an account, so say exactly that.
  if (!cloud.signedIn()) {
    return invite
      ? `<section class="lg-card lg-race" data-state="signed-out" aria-label="${esc(tr(M).race.title)}">
      <p class="lg-note lg-invite-signin" data-invite-signin="1">${esc(tr(M).invite.signIn(invite))}</p>
    </section>`
      : '';
  }
  const m = tr(M).race;
  const live = progress.liveWeek;
  const mineTotal = progress.closed;

  const view = rival.month;
  const theirWeeks = view?.month.weeks ?? {};
  const theirTotal = view?.month.monthlyScore ?? 0;
  // Recent duel opponents are SUGGESTIONS for the field — never a rival.
  const list = cloud.recent().map((h) => `<option value="${esc(h)}"></option>`).join('');
  const myHandle = cloud.myHandle();

  // The month is already on the title; the head answers the other question a
  // person has here — "what name do I read out to them". An invitation that
  // is waiting for an answer comes first of all.
  const head = `${invite ? inviteAsk(invite) : ''}${
    myHandle ? `<div class="lg-race-head"><span class="lg-chip">${m.you(esc(myHandle))}</span></div>` : ''
  }`;
  /** The empty state's call to action: invite somebody, by link. */
  const call = myHandle ? inviteCall() : '';

  const search = `
    <div class="lg-search">
      <label class="lg-label" for="lgHandle">${m.label}</label>
      <div class="lg-row">
        <input class="lg-input" id="lgHandle" type="text" inputmode="text" autocomplete="off"
          list="lgRivals" maxlength="20" value="${esc(rival.query)}" placeholder="${esc(m.placeholder)}"
          aria-label="${esc(m.aria)}">
        <button class="lg-find" id="lgFind" type="button" ${rival.loading ? 'disabled' : ''}>
          ${rival.loading ? m.loading : m.search}
        </button>
      </div>
      <datalist id="lgRivals">${list}</datalist>
    </div>`;

  if (rival.error) {
    return `
    <section class="lg-card lg-race" data-state="missing" aria-label="${esc(m.title)}">
      <h3 class="lg-title">${m.title} <span class="lg-sub">${esc(monthHe(month))}</span></h3>
      ${head}${call}${search}
      <p class="lg-note warn">${esc(rivalErrorText(rival.error))}</p>
    </section>`;
  }

  if (!rival.handle || !view) {
    return `
    <section class="lg-card lg-race" data-state="idle" aria-label="${esc(m.title)}">
      <h3 class="lg-title">${m.title} <span class="lg-sub">${esc(monthHe(month))}</span></h3>
      ${head}${call}${search}
      <p class="lg-note">${m.invite}</p>
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
  <section class="lg-card lg-race" data-state="ready" aria-label="${esc(m.title)}">
    <h3 class="lg-title">${m.title} <span class="lg-sub">${esc(monthHe(month))}</span></h3>
    ${head}${search}
    <div class="lg-cols">
      <div class="lg-colhead">
        <span class="lg-wk"></span>
        <span class="lg-cell mine">${m.me}</span>
        <span class="lg-cell theirs">${esc(rival.handle)}${
          rival.dev
            ? ` <span class="lg-dev" title="${esc(tr(M).dev)}" aria-label="${esc(tr(M).dev)}">🛠</span>`
            : ''
        }</span>
      </div>
      ${rows}
      <div class="lg-week total" data-week="total">
        <div class="lg-wk">${m.total}</div>
        <div class="lg-cell mine" data-side="mine">
          <b class="lg-total" data-total="mine">${fmtScore(mineTotal)}</b>${
            progress.live > 0
              ? `<span class="lg-total-live" data-total-live="${progress.live}">${m.liveTotal(
                  fmtScore(progress.live),
                )}</span>`
              : ''
          }
        </div>
        <div class="lg-cell theirs" data-side="theirs"><b class="lg-total" data-total="theirs">${fmtScore(theirTotal)}</b></div>
      </div>
    </div>
    <p class="lg-leader ${mineTotal >= theirTotal ? 'ok' : 'warn'}">${esc(leaderHe(mineTotal, theirTotal, rival.handle))}</p>
    ${
      progress.live > 0
        ? `<p class="lg-note dim" data-closed-only="1">${m.closedOnly}</p>`
        : ''
    }
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
  const m = tr(M).item;
  const price = priceOf(item.kind);
  const claimed = opts.claimedOn !== null;
  return `
    <div class="lg-item" data-item="${esc(item.id)}" data-kind="${item.kind}"
      data-state="${claimed ? 'claimed' : 'open'}">
      <div class="li-head"><span class="li-emoji" aria-hidden="true">${item.emoji}</span><b>${esc(leagueItemName(item))}</b></div>
      <p class="li-detail">${esc(leagueItemDetail(item))}</p>
      <div class="li-foot">
        <span class="li-price">🔵 ${price}${item.bonus > 0 ? m.bonus(item.bonus) : ''}</span>
        ${
          claimed
            ? `<span class="li-claimed" data-claimed="1">✓ ${item.kind === 'challenge' ? m.completed : m.redeemed} ${esc(
                fmtDate(opts.claimedOn as string),
              )}</span>`
            : `<button class="lg-btn li-btn" type="button" data-${opts.action}="${esc(item.id)}">${
                item.kind === 'challenge' ? m.stake(price) : m.redeem(price)
              }</button>`
        }
      </div>
    </div>`;
}

/** The confirmation sheet — nothing is written until it is confirmed. */
function spendSheet(game: GameState, month: string, mode: PrizeMode): string {
  if (!pending) return '';
  const pool = poolOfMonth(month, mode);
  const item = [...pool.rewards, ...pool.challenges].find((i) => i.id === pending?.id);
  if (!item) return '';
  const cost = priceOf(item.kind);
  const coins = game.league.coins;
  const missing = Math.max(0, cost - coins);
  const m = tr(M);
  const contract = mode === 'couple' ? m.honor : m.selfReward;
  return `
    <div class="lg-sheet" id="lgSheet" role="group" aria-label="${esc(m.sheet.aria)}">
      <div class="ls-head"><b>${item.emoji} ${esc(leagueItemName(item))}</b><span>${esc(leagueItemDetail(item))}</span></div>
      <p class="ls-price">${m.sheet.price(cost, coins)}${
        missing > 0 ? ` · <span class="warn">${m.sheet.missing(missing)}</span>` : ''
      }</p>
      ${
        item.kind === 'challenge'
          ? `<p class="lg-note dim">${m.sheet.stakeNote(cost, item.bonus)}</p>`
          : `<p class="lg-note dim">${m.sheet.redeemNote(esc(contract))}</p>`
      }
      ${pending.error ? `<p class="lg-error" data-error="1">${esc(m.errors[pending.error])}</p>` : ''}
      <div class="ls-actions">
        <button class="lg-btn buy" type="button" data-confirm="1">${
          item.kind === 'challenge' ? m.sheet.confirmStake : m.sheet.confirmRedeem
        }</button>
        <button class="lg-btn off" type="button" data-cancel="1">${m.sheet.cancel}</button>
      </div>
    </div>`;
}

/** חנות החודש — the pool, the purse and the two spending flows. */
/**
 * פרסים: אישיים / זוגיים — the device's prize mode, as two pressed-or-not
 * buttons. Switching writes `UiState.prizes` and nothing else: no event, and
 * every item already redeemed stays redeemed (the ledger keys by id).
 */
function prizeToggle(mode: PrizeMode): string {
  const m = tr(M).prizes;
  const seg = (value: PrizeMode, label: string): string => `
      <button class="lg-seg${mode === value ? ' on' : ''}" type="button" data-prizes="${value}"
        aria-pressed="${mode === value ? 'true' : 'false'}">${label}</button>`;
  return `
    <div class="lg-prizes" role="group" aria-label="${esc(m.aria)}" data-mode="${mode}">
      <span class="lg-prizes-k">${m.label}</span>${seg('personal', m.personal)}${seg('couple', m.couple)}
    </div>`;
}

function shopCard(
  game: GameState,
  month: string,
  behind: boolean,
  dates: Map<string, string>,
  mode: PrizeMode,
): string {
  const m = tr(M);
  const pool = poolOfMonth(month, mode);
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
        <div class="li-head"><span class="li-emoji" aria-hidden="true">⚔️</span><b>${esc(leagueItemName(staked))}</b></div>
        <p class="li-detail">${esc(leagueItemDetail(staked))}</p>
        <div class="li-foot">
          <span class="li-price">${m.shop.stakedPrice(stake?.cost ?? priceOf('challenge'), staked.bonus)}</span>
          ${
            completed === undefined
              ? `<button class="lg-btn li-btn done" type="button" data-complete="1">${m.shop.done}</button>`
              : `<span class="li-claimed" data-claimed="1">✓ ${m.shop.completed}${
                  dates.has(`${month}|${staked.id}`) ? ` ${esc(fmtDate(dates.get(`${month}|${staked.id}`) as string))}` : ''
                } · +${completed} 🔵</span>`
          }
        </div>
      </div>`
    : pool.challenges.map((item) => itemCard(item, { claimedOn: null, action: 'stake' })).join('');

  return `
  <section class="lg-card lg-shop ${behind ? 'behind' : ''}" data-behind="${behind ? '1' : '0'}"
    aria-label="${esc(m.shop.title)}">
    <h3 class="lg-title">${m.shop.title} <span class="lg-sub">${esc(monthHe(month))}</span></h3>
    ${prizeToggle(mode)}
    <div class="lg-purse">
      <b data-purse="1">🔵 ${league.coins}</b>
      <span>${m.shop.purse(league.coinsEarned, league.coinsSpent)}</span>
    </div>
    ${
      mode === 'couple'
        ? `<p class="lg-honor" data-honor="1">${esc(m.honor)}</p>`
        : `<p class="lg-honor self" data-self-reward="1">${esc(m.selfReward)}</p>`
    }
    ${behind ? `<p class="lg-note warn" data-behind-note="1">${esc(m.behind)}</p>` : ''}
    ${spendSheet(game, month, mode)}
    <h4 class="lg-sub-title">${m.shop.rewards}</h4>
    <div class="lg-pool">${rewards}</div>
    <h4 class="lg-sub-title">${m.shop.challenge} <span class="lg-sub">${
      staked ? m.shop.activeStake : m.shop.oneAMonth
    }</span></h4>
    <div class="lg-pool challenges">${challenges}</div>
  </section>`;
}

/** היסטוריה — the months already settled, newest first. */
function historyCard(game: GameState, month: string): string {
  const m = tr(M).history;
  const months = Object.values(game.league.months)
    .filter((m) => m.month !== month)
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  const body =
    months.length === 0
      ? `<p class="lg-note dim">${m.empty}</p>`
      : `<ul class="lg-months">${months
          .map(
            (mo) => `
        <li class="lg-month" data-month="${esc(mo.month)}">
          <span class="lm-name">${esc(monthHe(mo.month))}</span>
          <span class="lm-score"><b>${fmtScore(mo.score)}</b> ${m.points}</span>
          <span class="lm-weeks">${m.weeks(mo.weeks)}</span>
          <span class="lm-coins">🔵 ${mo.coins}</span>
        </li>`,
          )
          .join('')}</ul>`;

  return `
  <section class="lg-card lg-history" aria-label="${esc(m.aria)}">
    <h3 class="lg-title">${m.title} <span class="lg-sub">${m.sub}</span></h3>
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
  const mode = modeOf(deps.store);
  // "Behind" is only knowable with a rival on screen; without one nothing is
  // de-emphasised, because nobody has been beaten. It is the SAME comparison the
  // race's leader line makes — closed weeks against closed weeks — so the shop
  // can never dim on a lead the totals row does not show. And it is the
  // COUPLE's rule: personal prizes are not owed to anybody.
  const behind = mode === 'couple' && rival.month !== null && theirTotal > progress.closed;
  const invite = deps.store.getState().ui.invite ?? '';

  return `
  ${liveCard(progress.liveWeek)}
  ${raceCard(game, month, progress, invite, deps.cloud)}
  ${shopCard(game, month, behind, dates, mode)}
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
    rival.error = null;
  });
  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void findRival(main, deps, input.value, month);
  });
  main.querySelector<HTMLButtonElement>('#lgFind')?.addEventListener('click', () => {
    void findRival(main, deps, input?.value ?? rival.query, month);
  });

  /* ---- an invitation that opened the app: yes goes through findRival ---- */
  main.querySelector<HTMLButtonElement>('[data-invite-accept]')?.addEventListener('click', () => {
    const handle = deps.store.getState().ui.invite;
    clearInvite(deps.store);
    if (handle) void findRival(main, deps, handle, month);
    else again();
  });
  main.querySelector<HTMLButtonElement>('[data-invite-decline]')?.addEventListener('click', () => {
    clearInvite(deps.store);
    again();
  });

  /* ---- 📨 invite somebody: share sheet, else clipboard, else by hand ---- */
  main.querySelector<HTMLButtonElement>('#lgInvite')?.addEventListener('click', () => {
    void sendInvite(main, deps);
  });
  main.querySelector<HTMLTextAreaElement>('#lgInviteText')?.addEventListener('focus', (e) => {
    (e.currentTarget as HTMLTextAreaElement).select();
  });

  /* ---- the prize mode: a device preference, never an event ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-prizes]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset['prizes'];
      if (!isPrizeMode(next) || next === modeOf(deps.store)) return;
      deps.store.update((d) => {
        d.ui.prizes = next;
      });
      // An open sheet belongs to the other shop's item.
      pending = null;
      again();
    });
  });

  /* ---- the shop: open a sheet, never spend on the first tap ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-redeem]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['redeem'];
      if (!id) return;
      pending = { kind: 'reward', id, error: null };
      again();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-stake]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['stake'];
      if (!id) return;
      pending = { kind: 'challenge', id, error: null };
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
    const mode = modeOf(deps.store);
    const result =
      p.kind === 'reward'
        ? redeemLeagueReward(deps.store, month, p.id, new Date(), mode)
        : setLeagueChallenge(deps.store, month, p.id, new Date(), mode);
    if (!result.ok) {
      // A refusal never reached the log (`core/league.ts` decides first), so the
      // only thing to do is say why — inside the sheet, and once as a toast.
      const error = result.error ?? 'unknown_item';
      pending = { ...p, error };
      toast(tr(M).errors[error]);
      again();
      return;
    }
    pending = null;
    toast(p.kind === 'reward' ? tr(M).toast.redeemed(result.cost) : tr(M).toast.staked);
    again();
  });

  /* ---- the staked challenge: self-reported, and it PAYS ---- */
  main.querySelector<HTMLButtonElement>('[data-complete]')?.addEventListener('click', () => {
    const result = completeLeagueChallenge(deps.store, month);
    if (!result.ok) {
      toast(tr(M).errors[result.error ?? 'no_challenge']);
      return;
    }
    toast(tr(M).toast.completed);
    again();
  });
}

/* ------------------------------------------------------------- the rival */

/** The invitation was answered (either way): forget it. */
function clearInvite(store: DataStore): void {
  if (store.getState().ui.invite === undefined) return;
  store.update((d) => {
    delete d.ui.invite;
  });
}

/** Remember the rival this device chose, so the screen reopens on them. */
function rememberRival(store: DataStore, handle: string): void {
  if (store.getState().ui.rival === handle) return;
  store.update((d) => {
    d.ui.rival = handle;
  });
}

/**
 * The rival this device CHOSE — and nobody else.
 *
 * `UiState.rival` is the choice. Without one, the single migration (see the
 * header): the newest name on the shared recent list counts only if this
 * device has already RACED them — their league rows for this month are in the
 * local cache. Somebody who was merely duelled has no cached league month, so
 * they stay a suggestion in the datalist and the card stays an invitation.
 */
function chosenRival(store: DataStore, cloud: LeagueCloudDeps, month: string): string {
  const mine = cloud.myHandle();
  const chosen = store.getState().ui.rival;
  if (chosen !== undefined) return chosen && chosen !== mine ? chosen : '';
  const first = cloud.recent()[0];
  if (!first || first === mine) return '';
  const cached = cloud.cached(first, month);
  const raced =
    Object.keys(cached.month.weeks).length > 0 || cached.month.monthlyScore > 0 || cached.fetchedAt !== null;
  return raced ? first : '';
}

/**
 * 📨 — hand the invitation to the platform's share sheet; without one, copy it
 * to the clipboard; and whenever the share sheet was not used, put the text in
 * a selectable field as well, so a refused or absent clipboard can never leave
 * the person with nothing to send.
 */
async function sendInvite(main: HTMLElement, deps: LeagueDeps): Promise<void> {
  const cloud = deps.cloud;
  const handle = cloud?.myHandle() ?? '';
  if (!handle) return;
  const m = tr(M).invite;
  const url = inviteLink(location.origin, location.pathname, handle);
  const text = m.message(handle);
  const nav = navigator as Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: m.title, text, url });
      return;
    } catch (e) {
      // The person closed the sheet: that is an answer, not a failure.
      if (e instanceof Error && e.name === 'AbortError') return;
    }
  }
  inviteText = `${text}\n${url}`;
  let copied = false;
  try {
    if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(inviteText);
      copied = true;
    }
  } catch {
    /* no permission — the field below is the fallback */
  }
  toast(copied ? m.copied : m.copyManually);
  refresh(main, deps);
}

/**
 * Open on the rival this device chose, and refresh them from the network ONCE
 * per (handle, month) per mount.
 *
 * The cached copy is painted first and without a request (`cached`), so the
 * table is on screen before anything touches the wire; the refresh then either
 * confirms it (`stale: false`) or leaves the cached rows with their "נכון ל…"
 * line. `asked` is set BEFORE the await, which is what stops a repaint from
 * re-entering this function for ever. With no chosen rival nothing is fetched
 * at all: the card is an invitation.
 */
async function ensureRival(main: HTMLElement, deps: LeagueDeps, month: string): Promise<void> {
  const cloud = deps.cloud;
  if (!cloud || !cloud.signedIn() || rival.error) return;

  if (!rival.handle) {
    const chosen = chosenRival(deps.store, cloud, month);
    if (!chosen) return;
    rival = { ...rival, handle: chosen, query: rival.query || chosen, month: cloud.cached(chosen, month) };
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
  // The migrated rival becomes a recorded choice once there is a race to show.
  if (known) rememberRival(deps.store, handle);
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
    rival = { ...rival, query: raw, handle: '', month: null, error: { kind: 'handle', code: check.error ?? 'empty' } };
    refresh(main, deps);
    return;
  }
  if (check.handle === cloud.myHandle()) {
    rival = { ...rival, query: raw, handle: '', month: null, error: { kind: 'self' } };
    refresh(main, deps);
    return;
  }

  rival = {
    ...rival,
    query: check.handle,
    handle: check.handle,
    month: null,
    error: null,
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
    rival = { ...rival, loading: false, month: null, error: { kind: 'missing', handle: check.handle } };
    refresh(main, deps);
    return;
  }
  cloud.remember(check.handle);
  rememberRival(deps.store, check.handle);
  inviteText = null;
  rival = { ...rival, loading: false, month: view };
  await loadDev(cloud, check.handle);
  refresh(main, deps);
}
