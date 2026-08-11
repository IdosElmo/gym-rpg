/**
 * ui/character.ts — screen 2, "דמות".
 *
 * The SVG character (now wearing its equipment), the headline level, the six
 * body-part progress bars, the streak tier, the battle-energy bank, the COIN
 * SHOP and the world-boss trophy shelf.
 *
 * SHOP PLACEMENT (a Phase 3 decision): the shop lives here rather than in the
 * קרב tab, because buying a piece of gear immediately changes the character
 * drawing and the stat grid one card above it — cause and effect stay on the
 * same screen. The קרב tab keeps only the coin counter and a pointer to here,
 * so the arena stays a single-purpose screen you can use one-handed mid-workout.
 *
 * Everything the screen writes goes through `core/game.ts`, i.e. through events.
 */

import { BODY_PARTS, BODY_PART_HE, type BodyPart } from '../data/program.ts';
import { CHARACTERS, characterById } from '../data/characters.ts';
import {
  EQUIPMENT_SLOTS,
  SLOT_EMOJI,
  SLOT_HE,
  bonusHe,
  bossById,
  equipmentById,
  equipmentForSlot,
  worldById,
  type EquipmentSlot,
} from '../data/gameContent.ts';
import { buyCharacter, buyItem, equipItem, gameOf, selectCharacter } from '../core/game.ts';
import { levelProgress, ownsCharacter, statsOfGame } from '../core/xp.ts';
import type { DataStore, GameState } from '../storage/DataStore.ts';
import { characterSvg, trophyMedallion } from './characterSvg.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { fmtXp } from './xpfx.ts';

export interface CharacterDeps {
  store: DataStore;
  /** Re-render the whole screen after a purchase/equip (stats + SVG change). */
  rerender?: () => void;
}

/**
 * Parts that levelled up on the workout screen and have not been celebrated on
 * the character screen yet — they pulse once, on the next render.
 */
const pendingPulse = new Set<BodyPart>();

export function queuePartPulse(part: BodyPart): void {
  pendingPulse.add(part);
}

/** Which slot's shop drawer is open. Survives re-renders within the session. */
let openSlot: EquipmentSlot | null = null;

/**
 * The character whose purchase sheet is open, if any. Like `openSlot` this is
 * view state, not game state: nothing is written until the sheet is confirmed.
 */
let pendingCharacter: string | null = null;

/** Test/boot helper: forget any open purchase sheet. */
export function resetCharacterSheet(): void {
  pendingCharacter = null;
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

/* ------------------------------------------------------------------ shop */

function slotCard(game: GameState, slot: EquipmentSlot): string {
  const wornId = game.equipment.equipped[slot];
  const worn = wornId ? equipmentById(wornId) : undefined;
  const open = openSlot === slot;
  const items = equipmentForSlot(slot)
    .map((item) => {
      const owned = game.equipment.owned.includes(item.id);
      const equipped = wornId === item.id;
      const affordable = game.battle.coins >= item.cost;
      const action = equipped
        ? `<button class="eq-btn off" data-unequip="${slot}">הסר</button>`
        : owned
          ? `<button class="eq-btn on" data-equip="${item.id}">הצטייד</button>`
          : `<button class="eq-btn buy" data-buy="${item.id}" ${affordable ? '' : 'disabled'}>
               🪙 ${item.cost}
             </button>`;
      return `<li class="eq-item ${equipped ? 'equipped' : owned ? 'owned' : ''} ${affordable || owned ? '' : 'poor'}">
        <span class="eq-art" aria-hidden="true">${item.icon}</span>
        <span class="eq-body">
          <b>${esc(item.he)} <span class="eq-tier">דרגה ${item.tier}</span></b>
          <span class="eq-bonus">${esc(bonusHe(item.bonus))}</span>
          <span class="eq-note">${esc(item.note)}</span>
        </span>
        ${action}
      </li>`;
    })
    .join('');

  return `<section class="eq-slot ${open ? 'open' : ''}">
    <button class="eq-head" data-slot-toggle="${slot}" aria-expanded="${open}">
      <span class="eq-slot-name">${SLOT_EMOJI[slot]} ${SLOT_HE[slot]}</span>
      <span class="eq-worn">${worn ? esc(worn.he) : 'ריק'}</span>
      <span class="eq-caret" aria-hidden="true">${open ? '▲' : '▼'}</span>
    </button>
    ${open ? `<ul class="eq-list">${items}</ul>` : ''}
  </section>`;
}

function shopCard(game: GameState): string {
  const worn = EQUIPMENT_SLOTS.filter((s) => game.equipment.equipped[s]).length;
  return `
  <section class="game-card" id="shopCard">
    <h3 class="gc-title">חנות הציוד <span class="gc-sub">🪙 ${fmtXp(game.battle.coins)} · ${worn}/${EQUIPMENT_SLOTS.length} מצויד</span></h3>
    <div class="eq-slots">${EQUIPMENT_SLOTS.map((s) => slotCard(game, s)).join('')}</div>
    <p class="gc-note">מטבעות נצברים מגלים, ממיני־בוסים ובעיקר מבוסי עולם. הציוד מתווסף לסטטיסטיקות לפני בונוס הרצף — כך שגם הרצף מגביר אותו.</p>
  </section>`;
}

/* ------------------------------------------------------------- the roster */

/**
 * The "דמויות" strip: one card per roster entry, each drawn with the PLAYER'S
 * OWN body-part levels, so a card is a real preview ("this is what my character
 * looks like as a robot") rather than a stock portrait.
 *
 * Tapping an owned card switches character immediately (one tap, the big drawing
 * above changes). Tapping a locked one opens a confirmation sheet — a skin costs
 * real coins, so it never happens on a stray tap, and an unaffordable one says
 * exactly how many coins are missing instead of failing silently.
 */
function rosterCard(game: GameState): string {
  const selected = game.characters.selected;
  const coins = game.battle.coins;
  const unlocked = CHARACTERS.filter((c) => ownsCharacter(game, c.id)).length;

  const cards = CHARACTERS.map((c) => {
    const owned = ownsCharacter(game, c.id);
    const isSelected = owned && c.id === selected;
    const affordable = coins >= c.cost;
    const tag = isSelected ? '● נבחרה' : owned ? '✓ נפתחה' : `🪙 ${c.cost}`;
    const state = isSelected ? 'selected' : owned ? 'owned' : affordable ? 'locked' : 'locked poor';
    return `<li class="chr-item">
      <button class="chr-card ${state}" type="button" data-character="${c.id}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
        aria-label="${esc(c.he)}${owned ? '' : ` · ${c.cost} מטבעות`}">
        <span class="chr-art" aria-hidden="true">${characterSvg(game.parts, { character: c, label: c.he })}</span>
        <b class="chr-name">${esc(c.he)}</b>
        <span class="chr-tag">${tag}</span>
      </button>
    </li>`;
  }).join('');

  return `
  <section class="game-card" id="charRoster">
    <h3 class="gc-title">דמויות <span class="gc-sub">${unlocked}/${CHARACTERS.length} נפתחו · 🪙 ${fmtXp(coins)}</span></h3>
    <ul class="chr-row">${cards}</ul>
    ${buySheet(game)}
    <p class="gc-note">שתי דמויות הבסיס פתוחות תמיד וללא עלות. שאר הדמויות הן <b>קוסמטיקה בלבד</b> —
    הן לא משנות אף סטטיסטיקה, רק את המראה. כל דמות גדלה מאותן שש רמות גוף ולובשת את אותו ציוד.</p>
  </section>`;
}

/** The confirmation sheet of a pending purchase ('' when nothing is pending). */
function buySheet(game: GameState): string {
  if (!pendingCharacter) return '';
  const def = characterById(pendingCharacter);
  if (!def || ownsCharacter(game, def.id)) return '';
  const coins = game.battle.coins;
  const missing = Math.max(0, def.cost - coins);
  const affordable = missing === 0;
  return `
    <div class="chr-buy" id="chrBuy" role="group" aria-label="אישור רכישת דמות">
      <div class="chr-buy-head">
        <b>${esc(def.he)}</b>
        <span>${esc(def.note)}</span>
      </div>
      <p class="chr-buy-price">מחיר: <b>🪙 ${def.cost}</b> · יש לכם: <b>🪙 ${fmtXp(coins)}</b></p>
      <div class="chr-buy-actions">
        <button class="eq-btn buy" data-buy-character="${def.id}" ${affordable ? '' : 'disabled'}>
          ${affordable ? `🪙 ${def.cost} · קנייה` : `חסרים 🪙 ${missing}`}
        </button>
        <button class="eq-btn off" data-cancel-character="1">ביטול</button>
      </div>
      ${
        affordable
          ? '<p class="gc-note dim">הדמות תיפתח לתמיד ותיבחר מיד. אין לכך שום השפעה על הסטטיסטיקות.</p>'
          : `<p class="gc-note dim">חסרים ${missing} 🪙 — נצחו עוד גלים או בוס עולם ותחזרו.</p>`
      }
    </div>`;
}

/* -------------------------------------------------------------- trophies */

function trophiesCard(game: GameState): string {
  const ids = game.battle.bossesDefeated;
  const medals = ids
    .map((id) => {
      const boss = bossById(id);
      if (!boss) return '';
      const world = worldById(boss.world);
      return `<li class="trophy">
        ${trophyMedallion(boss, world.he)}
        <b>${esc(boss.he)}</b>
        <span>${esc(world.he)}</span>
      </li>`;
    })
    .join('');

  return `
  <section class="game-card">
    <h3 class="gc-title">גביעים <span class="gc-sub">${ids.length} בוסי עולם · ${game.battle.miniBossesCleared} מיני־בוסים</span></h3>
    ${
      medals
        ? `<ul class="trophy-shelf">${medals}</ul>`
        : '<p class="gc-note">עדיין לא הפלתם בוס עולם. כל בוס שתפילו ישאיר כאן גביע קבוע — ומדליה על החזה של הדמות. 🏆</p>'
    }
    <div class="char-meta trophy-meta">
      <div class="cm-item"><b>👑 ${game.battle.miniBossesCleared}</b><span>מיני־בוסים</span></div>
      <div class="cm-item"><b>⚔️ ${game.battle.wavesCleared}</b><span>גלים</span></div>
      <div class="cm-item"><b>🏛 ${ids.length}</b><span>בוסי עולם</span></div>
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ view */

export function renderCharacter(main: HTMLElement, deps: CharacterDeps): void {
  const game = gameOf(deps.store);
  const stats = statsOfGame(game);
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
  const trophies = game.battle.bossesDefeated.length;

  main.innerHTML = `
  <section class="char-card">
    <div class="char-stage">
      ${characterSvg(game.parts, {
        pulse,
        equipment: game.equipment,
        trophies,
        character: game.characters.selected,
      })}
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

  ${rosterCard(game)}

  <section class="game-card">
    <h3 class="gc-title">כוח לחימה <span class="gc-sub">רמות גוף + ציוד + רצף</span></h3>
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

  ${shopCard(game)}
  ${trophiesCard(game)}`;

  // LEVEL-UP CELEBRATION, layer two. `characterSvg` already marked the grown
  // groups with `.pulse` (they scale and glow in the accent colour); this adds a
  // brief golden wash over the WHOLE drawing, as a CSS `drop-shadow` filter on
  // the root svg. Deliberately not a palette change: `--ch-body` and friends are
  // what a skin overrides, and touching them here would snap a robot or a ninja
  // back to the default hero's blue for a second and a half.
  if (pulse.length > 0) main.querySelector('.char-stage .ch-svg')?.classList.add('leveled');

  wireShop(main, deps);
  wireRoster(main, deps);
}

/* ---------------------------------------------------------- roster wiring */

function wireRoster(main: HTMLElement, deps: CharacterDeps): void {
  const refresh = (): void => {
    if (deps.rerender) deps.rerender();
    else renderCharacter(main, deps);
  };

  main.querySelectorAll<HTMLButtonElement>('.chr-card[data-character]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['character'];
      if (!id) return;
      const game = gameOf(deps.store);
      if (ownsCharacter(game, id)) {
        // Owned: switch straight away — the big drawing above is the feedback.
        pendingCharacter = null;
        if (selectCharacter(deps.store, id)) toast(`${characterById(id)?.he ?? 'הדמות'} נכנסה לזירה! ✨`);
        refresh();
        return;
      }
      // Locked: never buy on the first tap — open the confirmation sheet.
      pendingCharacter = id;
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-buy-character]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['buyCharacter'];
      if (!id) return;
      const res = buyCharacter(deps.store, id);
      if (!res.ok) {
        toast(
          res.error === 'insufficient_coins'
            ? 'אין מספיק מטבעות — נצחו עוד גלים או בוס עולם. 🪙'
            : 'לא ניתן לרכוש את הדמות הזו.',
        );
        return;
      }
      pendingCharacter = null;
      toast(`${characterById(id)?.he ?? 'הדמות'} נרכשה ונכנסה לזירה! 🎭`);
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-cancel-character]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingCharacter = null;
      refresh();
    });
  });
}

/* ----------------------------------------------------------------- wiring */

function wireShop(main: HTMLElement, deps: CharacterDeps): void {
  const refresh = (): void => {
    if (deps.rerender) deps.rerender();
    else renderCharacter(main, deps);
  };

  main.querySelectorAll<HTMLButtonElement>('[data-slot-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset['slotToggle'] as EquipmentSlot | undefined;
      if (!slot) return;
      openSlot = openSlot === slot ? null : slot;
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['buy'];
      if (!id) return;
      const res = buyItem(deps.store, id);
      if (!res.ok) {
        toast(
          res.error === 'insufficient_coins'
            ? 'אין מספיק מטבעות — נצחו עוד גלים או בוס עולם. 🪙'
            : 'לא ניתן לקנות את הפריט הזה.',
        );
        return;
      }
      toast(`${equipmentById(id)?.he ?? 'הפריט'} נרכש והוצמד! ✨`);
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['equip'];
      const def = id ? equipmentById(id) : undefined;
      if (!def || !id) return;
      equipItem(deps.store, def.slot, id);
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-unequip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset['unequip'] as EquipmentSlot | undefined;
      if (!slot) return;
      equipItem(deps.store, slot, null);
      refresh();
    });
  });
}
