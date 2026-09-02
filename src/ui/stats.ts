/**
 * ui/stats.ts — the 📊 סטטיסטיקות screen (view `SS`), third inner tab of the
 * ⚙️ הגדרות hub.
 *
 * The numbers all come from `core/stats.ts`, which is pure; this file is only
 * the drawing, and it draws with THE APP'S OWN TOKENS — `--bg`, `--card`,
 * `--card-2`, `--line`, `--accent`, `--ok`, `--warn` — so the screen belongs to
 * the same app as the rest.
 *
 * ---------------------------------------------------------------------------
 * THE CHART CONVENTIONS THIS FILE SETS (there were none before it)
 * ---------------------------------------------------------------------------
 * 1. INLINE SVG, NO LIBRARY. Every chart is a handful of `<path>` / `<rect>`
 *    elements built as a string, like every other screen in this app. A chart
 *    library would be the first runtime dependency in the bundle and the build
 *    is a single self-contained file (`npm run verify`) — so, no.
 *
 * 2. ONE HUE PER CHART. Magnitude is drawn as one colour getting stronger
 *    (`--accent` at increasing opacity), never as a rainbow: a heat scale with
 *    six hues would say "these are six different KINDS of day", which is false.
 *    `--ok` / `--warn` stay reserved for what they already mean elsewhere in the
 *    app (good / attention), and never become "series 2".
 *
 * 3. TIME FLOWS RIGHT → LEFT. This is a Hebrew RTL app: reading starts at the
 *    right edge, so time does too. The sparkline's oldest week is at the RIGHT
 *    and the live week at the LEFT; the heatmap's oldest column is at the right
 *    and THIS week is the leftmost column, right where the eye lands last —
 *    which is the same place a left-to-right reader finds "now" in a GitHub
 *    contribution graph. SVG has no `direction`, so both charts compute their x
 *    coordinates in that order explicitly rather than relying on layout.
 *    The heatmap's weekday letters (א–ש) sit on the RIGHT of the grid, because
 *    that is where a Hebrew line starts.
 *
 * 4. THIN MARKS, RECESSIVE CHROME. 2px lines, a 10–14% area wash, ≥8px end
 *    markers ringed in the surface colour, hairline solid baselines and no axes
 *    at all. Labels are HTML around the SVG rather than `<text>` inside it: the
 *    labels are Hebrew, SVG text has no bidi layout worth trusting, and HTML
 *    labels stay selectable and scale with the user's font size.
 *
 * 5. NOTHING IS INTERACTIVE. The cards are read, not pressed — so there is no
 *    tap target to get wrong on a phone. Every cell and every point still
 *    carries a native `<title>`, which is the tooltip on a desktop and the
 *    accessible name everywhere.
 */

import { BODY_PART_HE, WEEKDAY_HE, WEEKDAY_SHORT_HE, type CardioSpec } from '../data/program.ts';
import { makeResolver } from '../core/plan.ts';
import { fmtDate, todayISO } from '../core/workout.ts';
import { computeStats, type HeatWeek, type Stats, type WeekPoint } from '../core/stats.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { esc } from './dom.ts';

export interface StatsDeps {
  store: DataStore;
  /** ISO "today" — injectable so a test can pin the calendar. */
  today?: string;
}

/** Kilogram unit, with the gershayim the rest of the app's copy uses. */
const KG = 'ק״ג';

/* -------------------------------------------------------------- numbers */

/** Thousands-separated integer. `1234.5` -> `"1,235"`. */
export function fmtInt(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  return v.toLocaleString('en-US');
}

/**
 * A number for reading rather than for auditing: thousands separated, and one
 * decimal only while the value is small enough for that decimal to mean
 * anything (a headline of "123,456.7 ק״ג" is noise, "12.5 ק״ג" is not).
 */
export function fmtNum(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) >= 1000 || Number.isInteger(v)) return fmtInt(v);
  return (Math.round(v * 10) / 10).toLocaleString('en-US');
}

/** Seconds -> "3 שעות ו‑12 דקות" / "45 דקות" / "50 שניות". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} שניות`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursHe = hours === 1 ? 'שעה אחת' : `${fmtInt(hours)} שעות`;
  return rest > 0 ? `${hoursHe} ו‑${rest} דקות` : hoursHe;
}

/** A percentage with its sign — growth is a story, and the sign tells it. */
function fmtPct(p: number): string {
  return `${p > 0 ? '+' : ''}${fmtInt(p)}%`;
}

/** "42.5 × 10" — always LTR, like every other number pair in the app. */
function fmtSet(weight: number, reps: number, timed: boolean, cardio: CardioSpec | null = null): string {
  // a cardio stage: its load in its own unit, and minutes — never kilograms
  if (cardio) return `${fmtNum(weight)}${cardio.loadUnit} × ${fmtNum(reps)} דק׳`;
  if (timed) return `${fmtNum(reps)} שנ׳${weight > 0 ? ` · ${fmtNum(weight)} ${KG}` : ''}`;
  if (weight <= 0) return `${fmtNum(reps)} חזרות`;
  return `${fmtNum(weight)} ${KG} × ${fmtNum(reps)}`;
}

/* ----------------------------------------------------------- the cards */

/** 💪 The headline: everything you have ever lifted, and what that weighs. */
function heroCard(stats: Stats): string {
  const { headline, next, all } = stats.equivalents;
  const rungs = all
    .map(
      (r) => `<li class="eq ${r.reached ? 'on' : ''}">
      <span class="eq-emoji" aria-hidden="true">${r.eq.emoji}</span>
      <b class="eq-count">${fmtNum(r.count)}</b>
      <span class="eq-name">${esc(r.eq.plural)}</span>
    </li>`,
    )
    .join('');

  return `
  <section class="game-card stats-hero">
    <h3 class="gc-title">💪 סה״כ הרמתם <span class="gc-sub">כל הסטים שסומנו ✓</span></h3>
    <p class="hero-num"><b>${fmtInt(stats.basics.tonnage)}</b> <span class="hero-unit">${KG}</span></p>
    ${
      headline
        ? `<p class="hero-eq">${headline.eq.emoji} זה <b>${fmtNum(headline.count)}</b> ${esc(headline.eq.plural)}!</p>`
        : `<p class="hero-eq">כל ק״ג נספר — גם הראשון. 💪</p>`
    }
    ${
      next
        ? `<p class="gc-note">עוד <b>${fmtInt(next.remaining)} ${KG}</b> ל${esc(next.eq.he)} ${next.eq.emoji}</p>`
        : `<p class="gc-note">הרמתם יותר ממגדל אייפל. אין לנו יחידות מידה גדולות יותר. 🗼</p>`
    }
    <ul class="eq-list">${rungs}</ul>
  </section>`;
}

/** The plain counters — the ones a training app owes its user. */
function basicsCard(stats: Stats): string {
  const b = stats.basics;
  const g = stats.game;
  const weekday = b.topWeekday === null ? '—' : (WEEKDAY_HE[b.topWeekday] ?? '—');
  const tiles: Array<[string, string]> = [
    ['אימונים', fmtInt(b.workouts)],
    ['סטים', fmtInt(b.sets)],
    ['חזרות', fmtInt(b.reps)],
    ['שניות פלאנק', fmtInt(b.seconds)],
    // a tile that is always 0 for a lifter is noise — it appears with the first cardio stage
    ...(b.cardioMinutes > 0 ? [['דקות קרדיו', fmtNum(b.cardioMinutes)] as [string, string]] : []),
    ['שיאים אישיים', fmtInt(g.prs)],
    ['אימונים לשבוע', fmtNum(b.perWeek)],
    ['דרגת רצף', fmtInt(g.streakTier)],
    ['שיא רצף', fmtInt(g.bestStreakTier)],
    ['היום החזק', weekday],
  ];
  return `
  <section class="game-card">
    <h3 class="gc-title">📋 המספרים היבשים
      <span class="gc-sub">${b.firstDate ? `מאז ${fmtDate(b.firstDate)}` : 'עדיין לא התחלנו'}</span>
    </h3>
    <div class="stat-grid stats-tiles">
      ${tiles.map(([k, v]) => `<div class="stat"><span class="s-k">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
    </div>
  </section>`;
}

/* ------------------------------------------------------- the sparkline */

const SPARK_W = 320;
const SPARK_H = 96;
const SPARK_PAD_X = 10;
const SPARK_PAD_TOP = 12;
const SPARK_PAD_BOTTOM = 12;

/**
 * The 12-week tonnage line — one series, so no legend: the card title says
 * what is plotted, and a one-swatch legend box would only restate it.
 *
 * Oldest week on the RIGHT (see the header of this file). The current week is
 * the last point and is drawn with the end marker, because it is the one number
 * still moving.
 */
export function sparklineSvg(weeks: readonly WeekPoint[]): string {
  const n = weeks.length;
  if (n === 0) return '';
  const max = weeks.reduce((m, w) => Math.max(m, w.tonnage), 0);
  const plotW = SPARK_W - SPARK_PAD_X * 2;
  const plotH = SPARK_H - SPARK_PAD_TOP - SPARK_PAD_BOTTOM;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const baseline = SPARK_PAD_TOP + plotH;
  // i = 0 is the OLDEST week and sits at the right edge: time runs with the
  // reading direction, which in Hebrew is right to left.
  const x = (i: number): number => Math.round((SPARK_W - SPARK_PAD_X - i * step) * 10) / 10;
  const y = (v: number): number =>
    Math.round((max > 0 ? SPARK_PAD_TOP + (1 - v / max) * plotH : baseline) * 10) / 10;

  const points = weeks.map((w, i) => `${x(i)},${y(w.tonnage)}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`;
  const lastX = x(n - 1);
  const lastY = y(weeks[n - 1]?.tonnage ?? 0);

  const dots = weeks
    .map(
      (w, i) =>
        `<circle class="sp-hit" cx="${x(i)}" cy="${y(w.tonnage)}" r="3">` +
        `<title>${esc(fmtDate(w.weekStart))} · ${fmtInt(w.tonnage)} ${KG} · ${fmtInt(w.sets)} סטים</title></circle>`,
    )
    .join('');

  return `<svg class="chart spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" role="img"
    aria-label="טונאז׳ שבועי ב־${n} השבועות האחרונים">
    <line class="sp-base" x1="${SPARK_PAD_X}" y1="${baseline}" x2="${SPARK_W - SPARK_PAD_X}" y2="${baseline}"/>
    <path class="sp-area" d="${area}"/>
    <path class="sp-line" d="${line}"/>
    ${dots}
    <circle class="sp-dot" cx="${lastX}" cy="${lastY}" r="4"/>
  </svg>`;
}

function weeklyCard(stats: Stats): string {
  const weeks = stats.weekly;
  const values = weeks.map((w) => w.tonnage);
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  const min = values.reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY);
  const current = weeks[weeks.length - 1];
  const peak = weeks.find((w) => w.tonnage === max);
  return `
  <section class="game-card">
    <h3 class="gc-title">📈 טונאז׳ שבועי <span class="gc-sub">${weeks.length} שבועות אחרונים</span></h3>
    ${sparklineSvg(weeks)}
    <div class="chart-legend">
      <span class="cl-item"><i class="dot live"></i>השבוע (חי): <b>${fmtInt(current?.tonnage ?? 0)} ${KG}</b></span>
      <span class="cl-item">שיא: <b>${fmtInt(max)} ${KG}</b>${peak ? ` · ${esc(fmtDate(peak.weekStart))}` : ''}</span>
      <span class="cl-item">נמוך: <b>${fmtInt(Number.isFinite(min) ? min : 0)} ${KG}</b></span>
    </div>
    <p class="gc-note dim">הזמן זורם מימין לשמאל — השבוע הנוכחי בקצה השמאלי.</p>
  </section>`;
}

/* --------------------------------------------------------- the heatmap */

const CELL = 13;
const CELL_GAP = 3;
const CELL_STEP = CELL + CELL_GAP;
const LABEL_W = 16;

/**
 * The calendar. Newest week is the LEFTMOST column and the weekday letters sit
 * on the right of the grid, because a Hebrew line starts on the right.
 *
 * The gap between cells is the surface showing through — no cell ever gets a
 * border, which would add ink that is not data.
 */
export function heatmapSvg(weeks: readonly HeatWeek[]): string {
  const n = weeks.length;
  const gridW = n * CELL_STEP - CELL_GAP;
  const width = gridW + LABEL_W;
  const height = 7 * CELL_STEP - CELL_GAP;
  // Newest first: column 0 is drawn at x = 0, i.e. at the LEFT edge.
  const columns = [...weeks].reverse();

  const cells = columns
    .map((week, c) =>
      week.days
        .map((d, r) => {
          const cls = `hm-cell l${d.level}${d.future ? ' future' : ''}`;
          const label = d.future
            ? `${fmtDate(d.date)} · עוד לא היה`
            : `${fmtDate(d.date)} · ${d.sets} סטים${d.tonnage > 0 ? ` · ${fmtInt(d.tonnage)} ${KG}` : ''}`;
          return `<rect class="${cls}" x="${c * CELL_STEP}" y="${r * CELL_STEP}" width="${CELL}" height="${CELL}" rx="3">
            <title>${esc(label)}</title></rect>`;
        })
        .join(''),
    )
    .join('');

  const labels = WEEKDAY_SHORT_HE.map(
    (l, r) =>
      `<text class="hm-day" x="${gridW + 5}" y="${r * CELL_STEP + CELL - 3}">${esc(l)}</text>`,
  ).join('');

  return `<svg class="chart heat" viewBox="0 0 ${width} ${height}" role="img"
    aria-label="לוח אימונים של ${n} השבועות האחרונים">${cells}${labels}</svg>`;
}

function heatmapCard(stats: Stats): string {
  const days = stats.heatmap.flatMap((w) => w.days);
  const trained = days.filter((d) => d.sets > 0).length;
  const swatches = [0, 1, 2, 3, 4].map((l) => `<i class="hm-key l${l}"></i>`).join('');
  return `
  <section class="game-card">
    <h3 class="gc-title">🗓 לוח האימונים <span class="gc-sub">${stats.heatmap.length} שבועות · ${trained} ימי אימון</span></h3>
    <div class="chart-wrap">${heatmapSvg(stats.heatmap)}</div>
    <div class="chart-legend hm-legend">
      <span class="cl-item">פחות ${swatches} יותר</span>
      <span class="cl-item dim">העמודה השמאלית — השבוע הזה</span>
    </div>
  </section>`;
}

/* --------------------------------------------------- body-part balance */

function balanceCard(stats: Stats): string {
  const b = stats.balance;
  const rows = b.parts
    .map((p) => {
      const pct = Math.round(p.ratio * 100);
      const share = b.total > 0 ? Math.round((p.volume / b.total) * 100) : 0;
      const tag = p.part === b.most ? '<span class="bal-tag most">הכי חזק</span>' : p.part === b.least ? '<span class="bal-tag least">הכי מוזנח</span>' : '';
      return `
      <div class="bal-row" data-part="${p.part}">
        <div class="part-head">
          <span class="part-name">${esc(BODY_PART_HE[p.part])}${tag}</span>
          <span class="part-level">${share}%</span>
        </div>
        <div class="part-bar"><span style="width:${pct}%"></span></div>
        <div class="part-foot">
          <span>${fmtInt(p.volume)} נק׳ עומס</span>
          <span class="part-xp">${p.tonnage > 0 ? `${fmtInt(p.tonnage)} ${KG}` : 'משקל גוף'}</span>
        </div>
      </div>`;
    })
    .join('');

  const most = b.most ? BODY_PART_HE[b.most] : '';
  const least = b.least ? BODY_PART_HE[b.least] : '';
  return `
  <section class="game-card">
    <h3 class="gc-title">⚖️ איזון בין חלקי הגוף <span class="gc-sub">נקודות עומס לפי החלוקה של מנוע ה‑XP</span></h3>
    <div class="parts bal-parts">${rows}</div>
    ${
      b.most && b.least && b.most !== b.least
        ? `<p class="gc-note">הכי הרבה עבודה נכנסה ל<b>${esc(most)}</b>, והכי מעט ל<b>${esc(least)}</b> — שווה סט או שניים נוספים.</p>`
        : `<p class="gc-note">סמנו עוד סטים כדי לראות איפה הגוף מקבל יותר עבודה ואיפה פחות.</p>`
    }
    <p class="gc-note dim">נקודת עומס = ק״ג×חזרות בתרגיל עם משקל, וחזרות או שניות בתרגיל משקל גוף — כדי שפלאנק ולחיצת חזה ימדדו על אותו סרגל.</p>
  </section>`;
}

/* ------------------------------------------------------ exercise bests */

function bestsCard(stats: Stats): string {
  if (stats.bests.length === 0) return '';
  const rows = stats.bests
    .map(
      (e) => `
      <tr>
        <td class="ex">${esc(e.he)}<span class="ex-sub">${fmtInt(e.sets)} סטים · ${fmtInt(e.sessions)} אימונים</span></td>
        <td class="num">${esc(fmtSet(e.best.weight, e.best.reps, e.timed, e.cardio))}</td>
        <td class="num">${esc(fmtSet(e.first.weight, e.first.reps, e.timed, e.cardio))}</td>
        <td class="grow ${e.growthPct !== null && e.growthPct > 0 ? 'up' : ''}">${
          e.growthPct === null ? '—' : `צמיחה: ${fmtPct(e.growthPct)}`
        }</td>
      </tr>`,
    )
    .join('');
  return `
  <section class="game-card">
    <h3 class="gc-title">🥇 השיאים שלכם <span class="gc-sub">${stats.bests.length} התרגילים הכי נטענים</span></h3>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th>תרגיל</th><th>הסט הכי טוב</th><th>הסט הראשון</th><th>שינוי</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

/* --------------------------------------------------------- game stats */

function gameCard(stats: Stats): string {
  const g = stats.game;
  const tiles: Array<[string, string]> = [
    ['גלים', fmtInt(g.wavesCleared)],
    ['מיני־בוסים', fmtInt(g.miniBosses)],
    ['בוסי עולם', fmtInt(g.worldBosses)],
    ['אתגרים הושלמו', fmtInt(g.dailyCompleted)],
    ['שיא אתגר', fmtInt(g.dailyBestScore)],
    ['דו־קרבות', `${fmtInt(g.duelWins)}‑${fmtInt(g.duelLosses)}`],
    ['מטבעות שנצברו', fmtInt(g.coinsEarned)],
    ['מטבעות שהוצאו', fmtInt(g.coinsSpent)],
    ['אנרגיה שיוצרה', fmtInt(g.energyEarned)],
  ];
  return `
  <section class="game-card">
    <h3 class="gc-title">🎮 שכבת המשחק <span class="gc-sub">רק ממה שקרה באמת</span></h3>
    <div class="stat-grid stats-tiles">
      ${tiles.map(([k, v]) => `<div class="stat"><span class="s-k">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
    </div>
    <p class="gc-note">⚡ ${fmtInt(g.energyEarned)} אנרגיה — מספיק להטעין טלפון <b>${fmtNum(g.phoneCharges)}</b> פעמים.</p>
  </section>`;
}

/* ----------------------------------------------------------- oddballs */

function oddCard(stats: Stats): string {
  const o = stats.odd;
  const items: string[] = [];

  items.push(
    `<li><span class="odd-k">⏱ מתחת לטיימר המנוחה</span><b>${esc(fmtDuration(o.restSeconds))}</b>
      <span class="odd-note">הערכה: כל סט שסומן × זמן המנוחה של התרגיל שלו</span></li>`,
  );

  if (o.heaviestSet) {
    const h = o.heaviestSet;
    items.push(
      `<li><span class="odd-k">🏋️ הסט הכבד ביותר אי פעם</span><b>${esc(fmtSet(h.weight, h.reps, h.timed))}</b>
        <span class="odd-note">${esc(h.he)} · ${esc(fmtDate(h.date))}</span></li>`,
    );
  }

  if (o.xpPerTon !== null) {
    items.push(
      `<li><span class="odd-k">✨ יעילות XP</span><b>${fmtNum(o.xpPerTon)} XP לכל טונה</b>
        <span class="odd-note">כמה ניסיון הרווחתם על כל 1,000 ${KG} שהזזתם</span></li>`,
    );
  }

  if (o.loyal) {
    items.push(
      `<li><span class="odd-k">🤝 התרגיל הכי נאמן</span><b>${esc(o.loyal.he)}</b>
        <span class="odd-note">הופיע ב‑${fmtInt(o.loyal.sessions)} אימונים שונים</span></li>`,
    );
  }

  if (o.longestGap) {
    items.push(
      `<li><span class="odd-k">🛌 ההפסקה הארוכה ששרדתם</span><b>${fmtInt(o.longestGap.days)} ימים</b>
        <span class="odd-note">${esc(fmtDate(o.longestGap.from))} ← ${esc(fmtDate(o.longestGap.to))} · וחזרתם 💪</span></li>`,
    );
  }

  return `
  <section class="game-card">
    <h3 class="gc-title">🎲 סטטיסטיקות מוזרות <span class="gc-sub">כי למה לא</span></h3>
    <ul class="odd-list">${items.join('')}</ul>
  </section>`;
}

/* ------------------------------------------------------------- screen */

/** Nothing logged yet — the one card the screen shows on a fresh install. */
function emptyCard(): string {
  return `
  <section class="game-card stats-empty">
    <h3 class="gc-title">📊 עוד אין מה לספור <span class="gc-sub">בינתיים</span></h3>
    <p class="gc-note">סמנו ✓ על הסט הראשון שלכם, וכאן יתחילו להצטבר: כמה ק״ג הרמתם בסך הכול
      (ובכמה פילים זה מסתכם), טונאז׳ שבועי, לוח אימונים, איזון בין חלקי הגוף והשיאים בכל תרגיל.</p>
    <p class="gc-note dim">הכול מחושב מהאימונים שלכם במכשיר — שום דבר לא נשלח לשום מקום.</p>
  </section>`;
}

/**
 * The whole screen as HTML — pure, so a test can render it without a store.
 *
 * The order is deliberate: the one number everybody came for, then the plain
 * counters, then the two time charts, then the "where is my training going"
 * cards, and the game layer last — this is the training screen of the app, and
 * the RPG is the reward on top of it.
 */
export function statsHtml(stats: Stats): string {
  if (stats.empty) return `${emptyCard()}${gameCard(stats)}`;
  return [
    heroCard(stats),
    basicsCard(stats),
    weeklyCard(stats),
    heatmapCard(stats),
    balanceCard(stats),
    bestsCard(stats),
    gameCard(stats),
    oddCard(stats),
  ].join('');
}

export function renderStats(main: HTMLElement, deps: StatsDeps): void {
  const state = deps.store.getState();
  main.innerHTML = statsHtml(
    computeStats({
      sessions: state.sessions,
      events: deps.store.getEvents(),
      // The plan-aware resolver, like the history screen: an exercise the user
      // invented still shows its own name here.
      resolve: makeResolver(state.plan),
      today: deps.today ?? todayISO(),
    }),
  );
}
