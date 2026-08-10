/**
 * ui/feed.ts — the game-event feed of screen 4 (היסטוריה).
 *
 * Pure(ish) projection of the append-only log into compact Hebrew lines:
 * level-ups, personal records, finished workouts, streak changes, battle
 * progress and imported backups. Nothing here reads state — the log is the
 * story.
 *
 * Runs of ordinary cleared waves are COLLAPSED into one line ("גלים 5–24"),
 * because a real player clears ~20 waves per workout and the feed has to stay
 * readable; mini-bosses and world bosses always get their own line.
 */

import { BODY_PART_HE, findExercise, type BodyPart, type ExerciseResolver } from '../data/program.ts';
import {
  EQUIPMENT_SLOTS,
  SLOT_HE,
  bossById,
  equipmentById,
  worldById,
  type EquipmentSlot,
} from '../data/gameContent.ts';
import { tsToIso } from '../core/xp.ts';
import { fmtDate } from '../core/workout.ts';
import type { AppEvent } from '../storage/DataStore.ts';
import { esc } from './dom.ts';

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
 * Build the feed, newest first. `limit` caps the number of LINES, not events.
 *
 * `resolve` defaults to the built-in lookup; the history screen passes a
 * plan-aware resolver so a PR on a CUSTOM exercise shows its name instead of
 * its raw `cx_…` id. An exercise that has since been deleted from the plan
 * still falls back to the id, exactly as a removed built-in always did.
 */
export function buildFeed(
  events: readonly AppEvent[],
  limit = 40,
  resolve: ExerciseResolver = findExercise,
): FeedItem[] {
  const items: FeedItem[] = [];
  let run: WaveRun | null = null;

  const flush = (): void => {
    if (!run) return;
    const world = worldById(run.world);
    const span = run.from === run.to ? `גל ${run.from}` : `גלים ${run.from}–${run.to}`;
    items.push({
      ts: run.ts,
      date: run.date,
      icon: '⚔️',
      cls: 'wave',
      text: `${span} ב${esc(world.he)} נוצחו · +${run.coins} 🪙`,
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
          text: `מיני־בוס בגל ${wave} (${esc(worldById(world).he)}) הופל! +${coins} 🪙`,
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
        const he = BODY_PART_HE[part] ?? part;
        items.push({
          ts: ev.ts,
          date,
          icon: '🎉',
          cls: 'level',
          text: `${esc(he)} עלה לרמה ${num(p['to'])}${p['retro'] === true ? ' (מהיסטוריה)' : ''}`,
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
          text: `שיא אישי ב${esc(ex ? ex.he : str(p['exId']))} · ${num(p['volume'])} (קודם ${num(p['previousBest'])})`,
        });
        break;
      }
      case 'workout_finished':
        items.push({ ts: ev.ts, date, icon: '💪', cls: 'workout', text: 'אימון הושלם במלואו' });
        break;
      case 'streak_changed': {
        const to = num(p['to']);
        const from = num(p['from']);
        items.push({
          ts: ev.ts,
          date,
          icon: to > from ? '🔥' : '🧊',
          cls: 'streak',
          text:
            to > from
              ? `שבוע מושלם! דרגת רצף ${to} · בונוס +${to * 10}% לכל הסטטיסטיקות`
              : `דרגת רצף ירדה ל־${to} · הבונוס עכשיו +${to * 10}%`,
        });
        break;
      }
      case 'boss_defeated': {
        const boss = bossById(str(p['bossId']));
        const world = worldById(Math.max(1, num(p['world'])));
        const name = boss ? boss.he : str(p['bossId']);
        items.push({
          ts: ev.ts,
          date,
          icon: p['endgame'] === true ? '👑' : '🏛',
          cls: 'boss',
          text:
            p['endgame'] === true
              ? `${esc(name)} הובס — מצב אלוף נפתח! +${num(p['coins'])} 🪙`
              : `בוס העולם ${esc(name)} (${esc(world.he)}) הובס! עולם ${num(p['nextWorld'])} נפתח · +${num(p['coins'])} 🪙`,
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
          text: `${esc(item ? item.he : str(p['itemId']))} נרכש בחנות · −${num(p['cost'])} 🪙`,
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
          text: `יובאו נתונים מקובץ (${num(p['added'])} אירועים)`,
        });
        break;
      }
      case 'item_equipped': {
        const id = str(p['itemId']);
        const item = id ? equipmentById(id) : undefined;
        const slot = str(p['slot']);
        const slotHe = isSlot(slot) ? SLOT_HE[slot] : slot;
        items.push({
          ts: ev.ts,
          date,
          icon: '🎽',
          cls: 'shop',
          text: item ? `${esc(item.he)} הוצמד (${esc(slotHe)})` : `${esc(slotHe)} הוסרה`,
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
): string {
  const items = buildFeed(events, limit, resolve);
  if (items.length === 0) {
    return `<section class="game-card">
      <h3 class="gc-title">יומן הרפתקה <span class="gc-sub">אירועי המשחק</span></h3>
      <p class="gc-note">עדיין אין אירועים. סמנו סטים כדי להעלות רמות ופתחו את לשונית הקרב. ⚔️</p>
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
  return `<section class="game-card">
    <h3 class="gc-title">יומן הרפתקה <span class="gc-sub">${items.length} אירועים אחרונים</span></h3>
    <ul class="feed">${rows}</ul>
  </section>`;
}
