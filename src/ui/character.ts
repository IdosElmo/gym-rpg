/**
 * ui/character.ts — screen 2, "דמות".
 *
 * The SVG character, the headline level, the six body-part progress bars, the
 * streak tier, the battle-energy bank and the Phase 3 placeholders (equipment +
 * trophies). Read-only: it renders `state.game`, which only the XP engine writes.
 */

import { BODY_PARTS, BODY_PART_HE, type BodyPart } from '../data/program.ts';
import { worldById } from '../data/gameContent.ts';
import { gameOf } from '../core/game.ts';
import { deriveStats, levelProgress } from '../core/xp.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { characterSvg } from './characterSvg.ts';
import { esc } from './dom.ts';
import { fmtXp } from './xpfx.ts';

export interface CharacterDeps {
  store: DataStore;
}

/**
 * Parts that levelled up on the workout screen and have not been celebrated on
 * the character screen yet — they pulse once, on the next render.
 */
const pendingPulse = new Set<BodyPart>();

export function queuePartPulse(part: BodyPart): void {
  pendingPulse.add(part);
}

const PART_ROLE_HE: Readonly<Record<BodyPart, string>> = {
  chest: 'כוח התקפה',
  back: 'הגנה',
  legs: 'נקודות חיים',
  shoulders: 'מהירות התקפה',
  arms: 'מכה קריטית',
  core: 'התאוששות',
};

const PART_EMOJI: Readonly<Record<BodyPart, string>> = {
  chest: '🛡',
  back: '🪖',
  legs: '❤️',
  shoulders: '⚡',
  arms: '💥',
  core: '♻️',
};

export function renderCharacter(main: HTMLElement, deps: CharacterDeps): void {
  const game = gameOf(deps.store);
  const stats = deriveStats(game.parts, game.streak.tier);
  const pulse = [...pendingPulse];
  pendingPulse.clear();

  const bars = BODY_PARTS.map((part) => {
    const p = levelProgress(game.parts[part].xp);
    const pct = Math.round(p.ratio * 100);
    return `
      <div class="part-row" data-part="${part}">
        <div class="part-head">
          <span class="part-name">${PART_EMOJI[part]} ${BODY_PART_HE[part]}</span>
          <span class="part-level">רמה ${p.level}</span>
        </div>
        <div class="part-bar"><span style="width:${pct}%"></span></div>
        <div class="part-foot">
          <span class="part-role">${PART_ROLE_HE[part]}</span>
          <span class="part-xp">${fmtXp(p.into)} / ${fmtXp(p.need)} XP</span>
        </div>
      </div>`;
  }).join('');

  const tier = game.streak.tier;
  const streakPct = Math.min(100, Math.round((game.streak.daysThisWeek / game.streak.needed) * 100));

  main.innerHTML = `
  <section class="char-card">
    <div class="char-stage">
      ${characterSvg(game.parts, { pulse })}
      <div class="char-level" aria-label="רמת דמות">
        <span class="cl-num">${game.level}</span><span class="cl-lbl">רמה</span>
      </div>
      ${tier > 0 ? `<div class="char-streak-chip">🔥 דרגה ${tier} · +${tier * 10}%</div>` : ''}
    </div>
    <div class="char-meta">
      <div class="cm-item"><b>${fmtXp(game.totalXp)}</b><span>סה״כ XP</span></div>
      <div class="cm-item"><b>⚡ ${fmtXp(game.energy)}</b><span>אנרגיית קרב</span></div>
      <div class="cm-item"><b>🪙 ${fmtXp(game.battle.coins)}</b><span>מטבעות</span></div>
      <div class="cm-item"><b>🏆 ${game.prCount}</b><span>שיאים אישיים</span></div>
    </div>
  </section>

  <section class="game-card">
    <h3 class="gc-title">כוח לחימה <span class="gc-sub">נגזר מרמות הגוף</span></h3>
    <div class="stat-grid">
      <div class="stat"><span class="s-k">התקפה</span><b>${stats.atk}</b></div>
      <div class="stat"><span class="s-k">הגנה</span><b>${stats.def}</b></div>
      <div class="stat"><span class="s-k">חיים</span><b>${stats.maxHp}</b></div>
      <div class="stat"><span class="s-k">מהירות</span><b>${(stats.attackIntervalMs / 1000).toFixed(2)}s</b></div>
      <div class="stat"><span class="s-k">קריטי</span><b>${Math.round(stats.critChance * 100)}%</b></div>
      <div class="stat"><span class="s-k">התאוששות</span><b>${stats.regen}</b></div>
    </div>
    <p class="gc-note">
      אלה הסטטיסטיקות שמפעילות את לשונית 🎮 קרב · ${esc(worldById(game.battle.world).he)} · גל ${game.battle.wave} · ${game.battle.wavesCleared} גלים נוצחו
    </p>
  </section>

  <section class="game-card">
    <h3 class="gc-title">חלקי גוף <span class="gc-sub">כל תרגיל מזין חלק אחר</span></h3>
    <div class="parts">${bars}</div>
  </section>

  <section class="game-card">
    <h3 class="gc-title">רצף שבועי <span class="gc-sub">${game.streak.needed} ימי אימון בשבוע</span></h3>
    <div class="streak-row">
      <div class="streak-tier">
        <b>${tier}</b><span>דרגת רצף</span>
      </div>
      <div class="streak-body">
        <div class="part-bar streak"><span style="width:${streakPct}%"></span></div>
        <p class="gc-note">
          השבוע: <b>${game.streak.daysThisWeek}/${game.streak.needed}</b> ימי אימון ·
          בונוס קבוע: <b>+${tier * 10}%</b> לכל הסטטיסטיקות
        </p>
        <p class="gc-note dim">שבוע מושלם מוסיף דרגה · שבוע עם פחות מ־${game.streak.needed} אימונים מוריד דרגה אחת (אף פעם לא מתחת ל־0, ורמות לעולם לא נלקחות).</p>
      </div>
    </div>
  </section>

  <section class="game-card locked">
    <h3 class="gc-title">ציוד <span class="gc-sub">בקרוב</span></h3>
    <div class="slot-grid">
      ${['כפפות', 'חגורה', 'נעליים', 'גלימה'].map((s) => `<div class="slot">${esc(s)}<span>ריק</span></div>`).join('')}
    </div>
    <p class="gc-note">
      חנות הציוד תיפתח בעדכון הבא — המטבעות שאתם צוברים בקרב (🪙 ${fmtXp(game.battle.coins)}) כבר נשמרים.
    </p>
  </section>

  <section class="game-card locked">
    <h3 class="gc-title">גביעים <span class="gc-sub">בקרוב</span></h3>
    <p class="gc-note">כל בוס שתפילו ישאיר גביע קבוע כאן. 🏆</p>
  </section>`;
}
