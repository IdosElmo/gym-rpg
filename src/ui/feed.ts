/**
 * ui/feed.ts — the game-event feed of screen 4 (היסטוריה).
 *
 * Pure(ish) projection of the append-only log into compact lines, in the
 * reader's language (the lines are built at render time, never stored):
 * level-ups, personal records, finished workouts, streak changes, battle
 * progress and imported backups. Nothing here reads state — the log is the
 * story.
 *
 * Runs of ordinary cleared waves are COLLAPSED into one line ("גלים 5–24"),
 * because a real player clears ~20 waves per workout and the feed has to stay
 * readable; mini-bosses and world bosses always get their own line.
 */

import { BODY_PART_HE, findExercise, type BodyPart, type ExerciseResolver } from '../data/program.ts';
import { skinOf } from '../data/characters.ts';
import {
  EQUIPMENT_SLOTS,
  SLOT_HE,
  bossById,
  equipmentById,
  worldById,
  type EquipmentSlot,
} from '../data/gameContent.ts';
import { BALANCE } from '../core/balance.ts';
import { upgradeLabel } from '../core/upgrades.ts';
import { tsToIso } from '../core/xp.ts';
import { fmtDate } from '../core/workout.ts';
import type { AppEvent } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { pick, tr } from '../i18n/locale.ts';
import { bodyPartName, exName } from '../i18n/content.ts';
import { feed as M } from '../i18n/messages/feed.ts';

export interface FeedItem {
  ts: number;
  date: string;
  icon: string;
  /** Already-escaped HTML fragment. */
  text: string;
  cls: string;
}

function dateOf(ev: AppEvent): string {
  const d = ev.payload['date'];
  return typeof d === 'string' && d.length === 10 ? d : tsToIso(ev.ts);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isSlot(v: string): v is EquipmentSlot {
  return (EQUIPMENT_SLOTS as readonly string[]).includes(v);
}

/** Open run of ordinary waves, waiting to be flushed into one line. */
interface WaveRun {
  ts: number;
  date: string;
  world: number;
  from: number;
  to: number;
  coins: number;
}

/**
 * Which parts a dev XP grant went into: one part by name, all six as
 * "every body part", anything between as a count — a six-name list would be
 * longer than the line it sits on.
 */
function devPartsHe(raw: unknown): string {
  const m = tr(M).devParts;
  if (typeof raw !== 'object' || raw === null) return '';
  const parts = Object.keys(raw as Record<string, unknown>).filter((k): k is BodyPart =>
    Object.prototype.hasOwnProperty.call(BODY_PART_HE, k),
  );
  const first = parts[0];
  if (parts.length === 1 && first) return m.one(bodyPartName(first));
  if (parts.length >= Object.keys(BODY_PART_HE).length) return m.all;
  if (parts.length > 1) return m.some(parts.length);
  return '';
}

/** An equipment slot's name in the reader's language. */
function slotName(slot: string): string {
  if (!isSlot(slot)) return slot;
  return tr(M).slots?.[slot] ?? SLOT_HE[slot];
}

/** Names the workout day of a `workout_finished` event ('' = leave it unnamed). */
export type DayNamer = (dayKey: string) => string;

/**
 * Build the feed, newest first. `limit` caps the number of LINES, not events.
 *
 * `resolve` defaults to the built-in lookup; the history screen passes a
 * plan-aware resolver so a PR on a CUSTOM exercise shows its name instead of
 * its raw `cx_…` id. An exercise that has since been deleted from the plan
 * still falls back to the id, exactly as a removed built-in always did.
 *
 * `dayName` names the workout day of a finished workout. It defaults to naming
 * nothing at all: the feed is a projection of the LOG, and the log does not know
 * which plan is active — only the screen does (`dayLabelOf`).
 */
export function buildFeed(
  events: readonly AppEvent[],
  limit = 40,
  resolve: ExerciseResolver = findExercise,
  dayName: DayNamer = () => '',
): FeedItem[] {
  const m = tr(M);
  const items: FeedItem[] = [];
  let run: WaveRun | null = null;

  const flush = (): void => {
    if (!run) return;
    const world = worldById(run.world);
    const span = run.from === run.to ? m.waves.one(run.from) : m.waves.range(run.from, run.to);
    items.push({
      ts: run.ts,
      date: run.date,
      icon: '⚔️',
      cls: 'wave',
      text: m.waves.cleared(span, esc(pick(world)), run.coins),
    });
    run = null;
  };

  for (const ev of [...events].sort((a, b) => a.ts - b.ts)) {
    const p = ev.payload;
    const date = dateOf(ev);

    if (ev.type === 'wave_cleared') {
      const world = Math.max(1, num(p['world']));
      const wave = Math.max(1, num(p['wave']));
      const coins = num(p['coins']);
      if (p['miniBoss'] === true) {
        flush();
        items.push({
          ts: ev.ts,
          date,
          icon: '👑',
          cls: 'boss',
          text: m.waves.miniBoss(p['overtime'] === true, wave, esc(pick(worldById(world))), coins),
        });
        continue;
      }
      if (run && run.world === world && run.to + 1 === wave && run.date === date) {
        run.to = wave;
        run.coins += coins;
        run.ts = ev.ts;
      } else {
        flush();
        run = { ts: ev.ts, date, world, from: wave, to: wave, coins };
      }
      continue;
    }

    flush();

    switch (ev.type) {
      case 'level_up': {
        const part = str(p['part']) as BodyPart;
        const he = Object.prototype.hasOwnProperty.call(BODY_PART_HE, part) ? bodyPartName(part) : part;
        items.push({
          ts: ev.ts,
          date,
          icon: '🎉',
          cls: 'level',
          text: m.levelUp(esc(he), num(p['to']), p['retro'] === true),
        });
        break;
      }
      case 'pr_achieved': {
        const ex = resolve(str(p['exId']));
        items.push({
          ts: ev.ts,
          date,
          icon: '🏆',
          cls: 'pr',
          text: m.pr(esc(ex ? exName(ex) : str(p['exId'])), num(p['volume']), num(p['previousBest'])),
        });
        break;
      }
      case 'workout_finished': {
        // The event carries the DAY KEY it was logged under; naming it is the
        // caller's job, because only a screen knows the active plan. A key the
        // plan dropped resolves to a neutral name (or to nothing), never to a
        // raw `d_…` string and never to another day's name.
        const label = dayName(str(p['day']));
        items.push({
          ts: ev.ts,
          date,
          icon: '💪',
          cls: 'workout',
          text: label ? m.workoutDay(esc(label)) : m.workout,
        });
        break;
      }
      case 'streak_changed': {
        const to = num(p['to']);
        const from = num(p['from']);
        items.push({
          ts: ev.ts,
          date,
          icon: to > from ? '🔥' : '🧊',
          cls: 'streak',
          text:
            to > from ? m.streakUp(to, to * 10) : m.streakDown(to, to * 10),
        });
        break;
      }
      case 'boss_defeated': {
        const boss = bossById(str(p['bossId']));
        const world = worldById(Math.max(1, num(p['world'])));
        const name = boss ? pick(boss) : str(p['bossId']);
        // An EARLY kill (below the recommended levels) is the bigger feat — say so.
        const early = num(p['deficit']) > 0 ? m.boss.early(num(p['deficit'])) : '';
        items.push({
          ts: ev.ts,
          date,
          icon: p['endgame'] === true ? '👑' : '🏛',
          cls: 'boss',
          text:
            p['endgame'] === true
              ? m.boss.endgame(esc(name), num(p['coins']), early)
              : m.boss.world(esc(name), esc(pick(world)), num(p['nextWorld']), num(p['coins']), early),
        });
        break;
      }
      /**
       * One daily-challenge run — one line, whatever the score. It names the
       * gauntlet's own date (the payload's `date` IS the challenge), so a run
       * always sits on the day it belonged to.
       */
      case 'daily_challenge': {
        const score = num(p['score'] ?? p['wavesCleared']);
        const complete = p['complete'] === true;
        items.push({
          ts: ev.ts,
          date,
          icon: complete ? '🏅' : '🎲',
          cls: 'daily',
          text: m.daily(score, BALANCE.daily.waves, num(p['coins']), complete),
        });
        break;
      }
      /**
       * A duel. One line with the purse it paid — read from the EVENT, like
       * every other coin line, so a line always quotes what that day actually
       * paid rather than what a duel would pay today. A duel logged before duels
       * paid anything carries no `coins` and quotes a zero, which is honest.
       */
      case 'ghost_duel': {
        const won = p['won'] === true;
        const who = str(p['opponentName']) || str(p['opponentHandle']);
        items.push({
          ts: ev.ts,
          date,
          icon: '⚔️',
          cls: won ? 'duel win' : 'duel loss',
          text: m.duel(won, esc(who), num(p['coins'])),
        });
        break;
      }
      /**
       * DEV MODE — the 🛠 lines.
       *
       * Ordinary `xp_gained` / `energy_gained` events are NOT feed lines (a real
       * workout writes dozens of them and the feed would be nothing else), so
       * these two cases render only the dev-marked ones. That asymmetry is the
       * point: a grant that did not come from training has to be visible, and
       * the feed is where this app explains itself.
       */
      case 'energy_gained': {
        if (p['dev'] !== true) break;
        items.push({
          ts: ev.ts,
          date,
          icon: '🛠',
          cls: 'dev',
          text: m.dev.energy(num(p['amount'])),
        });
        break;
      }
      case 'xp_gained': {
        if (p['dev'] !== true) break;
        items.push({
          ts: ev.ts,
          date,
          icon: '🛠',
          cls: 'dev',
          text: m.dev.xp(num(p['total']), esc(devPartsHe(p['parts']))),
        });
        break;
      }
      case 'coins_granted': {
        items.push({
          ts: ev.ts,
          date,
          icon: '🛠',
          cls: 'dev',
          text: m.dev.coins(num(p['amount'])),
        });
        break;
      }
      case 'dev_reset': {
        const scope = str(p['scope']);
        items.push({
          ts: ev.ts,
          date,
          icon: '🛠',
          cls: 'dev',
          text: scope === 'duels' ? m.dev.resetDuels : m.dev.resetDaily,
        });
        break;
      }
      /**
       * The purge stays a line of its own and the grants it took back stay
       * where they are: the feed is a projection of the LOG, and those grants
       * really did happen. This line is what explains why the numbers dropped.
       */
      case 'dev_purge': {
        items.push({
          ts: ev.ts,
          date,
          icon: '🛠',
          cls: 'dev',
          text: m.dev.purge,
        });
        break;
      }
      case 'coins_spent': {
        const item = equipmentById(str(p['itemId']));
        items.push({
          ts: ev.ts,
          date,
          icon: '🛒',
          cls: 'shop',
          text: m.bought(esc(item ? pick(item) : str(p['itemId'])), num(p['cost'])),
        });
        break;
      }
      /**
       * A JSON backup was folded into this log (`storage/merge.ts`). It changes
       * no state at all — it is here purely so a sudden jump in XP has a line
       * that explains it.
       *
       * Only `json_import` gets a line, and that is the only source that exists
       * in practice: the sync engine deliberately appends NOTHING when it merges
       * a cloud pull (a marker per pull would ping-pong between devices for
       * ever). A marker with any other source is folded and left unrendered
       * rather than described as a file that was never imported.
       */
      case 'data_merged': {
        if (p['source'] !== 'json_import') break;
        items.push({
          ts: ev.ts,
          date,
          icon: '⬆',
          cls: 'import',
          text: m.imported(num(p['added'])),
        });
        break;
      }
      /**
       * A cosmetic skin was bought. Only the PURCHASE gets a line: switching
       * body or skin is free and reversible, and a line per switch would bury
       * the training story the feed exists to tell. The line names the SKIN, not
       * a body — one purchase unlocked it on both.
       */
      case 'character_purchased': {
        const skin = skinOf(str(p['characterId']));
        items.push({
          ts: ev.ts,
          date,
          icon: '🎭',
          cls: 'shop',
          text: m.skin(esc(skin ? pick(skin) : str(p['characterId'])), num(p['cost'])),
        });
        break;
      }
      /**
       * An upgrade step. It gets its own line (unlike an equip/unequip, which
       * is free and reversible) because it SPENT coins and permanently changed
       * the character — the same bar `coins_spent` clears.
       */
      case 'item_upgraded': {
        const item = equipmentById(str(p['itemId']));
        const level = upgradeLabel(num(p['toLevel']));
        items.push({
          ts: ev.ts,
          date,
          icon: '⬆',
          cls: 'shop',
          text: m.upgraded(esc(item ? pick(item) : str(p['itemId'])), level, num(p['cost'])),
        });
        break;
      }
      case 'item_equipped': {
        const id = str(p['itemId']);
        const item = id ? equipmentById(id) : undefined;
        const slot = str(p['slot']);
        const slotHe = slotName(slot);
        items.push({
          ts: ev.ts,
          date,
          icon: '🎽',
          cls: 'shop',
          text: item ? m.equipped(esc(pick(item)), esc(slotHe)) : m.unequipped(esc(slotHe)),
        });
        break;
      }
      default:
        break;
    }
  }
  flush();

  // Built chronologically; reverse first so that events sharing a millisecond
  // still come out newest-first (Array#sort is stable).
  return items.reverse().sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function renderFeed(
  events: readonly AppEvent[],
  limit = 40,
  resolve: ExerciseResolver = findExercise,
  dayName: DayNamer = () => '',
): string {
  const items = buildFeed(events, limit, resolve, dayName);
  const m = tr(M).card;
  if (items.length === 0) {
    return `<section class="game-card">
      <h3 class="gc-title">${m.title} <span class="gc-sub">${m.emptySub}</span></h3>
      <p class="gc-note">${m.empty}</p>
    </section>`;
  }
  const rows = items
    .map(
      (i) => `<li class="feed-item ${i.cls}">
      <span class="fi-icon">${i.icon}</span>
      <span class="fi-text">${i.text}</span>
      <span class="fi-date">${fmtDate(i.date)}</span>
    </li>`,
    )
    .join('');
  // The lines scroll INSIDE the card (`.scroll-pane`, styles/history.css): forty
  // events are metres of page, and the card's own header — which says how many
  // there are — has to stay on screen while you read them.
  return `<section class="game-card">
    <h3 class="gc-title">${m.title} <span class="gc-sub">${m.sub(items.length)}</span></h3>
    <div class="scroll-pane feed-scroll"><ul class="feed">${rows}</ul></div>
  </section>`;
}
