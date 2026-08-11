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
import {
  BODY_EMOJI,
  BODY_GEOMETRIES,
  BODY_HE,
  SKINS,
  characterById,
  characterId,
  skinById,
  type BodyGeometry,
  type SkinDef,
} from '../data/characters.ts';
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
import { buyCharacter, buyItem, equipItem, gameOf, selectBody, selectCharacter } from '../core/game.ts';
import { levelProgress, ownsSkin, selectedBody, selectedCharacter, statsOfGame } from '../core/xp.ts';
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
 * The SKIN whose purchase sheet is open, if any. Like `openSlot` this is view
 * state, not game state: nothing is written until the sheet is confirmed.
 */
let pendingCharacter: string | null = null;

/**
 * THE TRY-ON. The locked SKIN the big drawing is temporarily wearing — always on
 * the body the player is actually playing, so a preview answers "what would this
 * look like on ME".
 *
 * Pure UI, in memory, exactly like `pendingCharacter`: previewing writes NO
 * event, never touches `game.characters`, and is invisible to everything that
 * reads the store — the arena keeps fighting as `game.characters.selected`
 * (`ui/battle.ts` reads it directly), so a preview can never leak into a battle.
 * It also dies on navigation: `ui/app.ts` calls `exitCharacterPreview()` on
 * every render of another screen.
 */
let previewCharacter: string | null = null;

/** Test/boot helper: forget any open purchase sheet (and any try-on). */
export function resetCharacterSheet(): void {
  pendingCharacter = null;
  previewCharacter = null;
}

/** Leave try-on mode — called whenever the דמות screen is left. */
export function exitCharacterPreview(): void {
  previewCharacter = null;
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
 * The "דמויות" section: a BODY toggle over a strip of SKIN cards.
 *
 * The two axes are separated because they are bought differently — a body is
 * free and instant, a skin costs coins — and because separating them is what
 * makes the matrix legible: pick who you are, then pick what you wear. Every
 * card is drawn on the CURRENTLY SELECTED BODY with the PLAYER'S OWN body-part
 * levels, so the strip answers "what does *my* character look like as a robot"
 * rather than showing a stock portrait; flipping the toggle redraws all of them.
 *
 * Tapping an owned skin switches immediately (one tap, the big drawing above
 * changes). Tapping a locked one opens a confirmation sheet — a skin costs real
 * coins, so it never happens on a stray tap, and an unaffordable one says
 * exactly how many coins are missing instead of failing silently.
 */
function rosterCard(game: GameState): string {
  const coins = game.battle.coins;
  const body = selectedBody(game);
  const currentSkin = selectedCharacter(game).skin;
  const unlocked = SKINS.filter((s) => ownsSkin(game, s.id)).length;
  const preview = previewDefOf(game);

  const bodies = BODY_GEOMETRIES.map((b) => {
    const on = b === body;
    return `<button class="chr-body ${on ? 'on' : ''}" type="button" data-body-select="${b}"
      aria-pressed="${on ? 'true' : 'false'}">
      <span aria-hidden="true">${BODY_EMOJI[b]}</span> ${BODY_HE[b]}
    </button>`;
  }).join('');

  const cards = SKINS.map((s) => {
    const owned = ownsSkin(game, s.id);
    const isSelected = owned && s.id === currentSkin;
    const affordable = coins >= s.cost;
    const previewing = preview?.id === s.id;
    const id = characterId(s.id, body);
    const def = characterById(id);
    const tag = previewing ? '👁 בתצוגה' : isSelected ? '● נבחרה' : owned ? '✓ נפתחה' : `🪙 ${s.cost}`;
    const state =
      (isSelected ? 'selected' : owned ? 'owned' : affordable ? 'locked' : 'locked poor') +
      (previewing ? ' previewing' : '');
    const he = def ? def.he : s.he;
    return `<li class="chr-item">
      <button class="chr-card ${state}" type="button" data-skin="${s.id}" data-character="${id}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
        aria-label="${esc(he)}${owned ? '' : ` · ${s.cost} מטבעות`}">
        <span class="chr-art" aria-hidden="true">${characterSvg(game.parts, { character: id, label: he })}</span>
        <b class="chr-name">${esc(s.he)}</b>
        <span class="chr-tag">${tag}</span>
      </button>
    </li>`;
  }).join('');

  return `
  <section class="game-card" id="charRoster">
    <h3 class="gc-title">דמויות <span class="gc-sub">${unlocked}/${SKINS.length} נפתחו · 🪙 ${fmtXp(coins)}</span></h3>
    <div class="chr-bodies" id="chrBodies" role="group" aria-label="בחירת גוף">${bodies}</div>
    <ul class="chr-row">${cards}</ul>
    ${buySheet(game)}
    <p class="gc-note">שני הגופים פתוחים תמיד וללא עלות, ו<b>כל מראה שנרכש נפתח בשניהם</b>.
    כל הדמויות הן <b>קוסמטיקה בלבד</b> — הן לא משנות אף סטטיסטיקה, רק את המראה.
    כל דמות גדלה מאותן שש רמות גוף ולובשת את אותו ציוד.</p>
  </section>`;
}

/**
 * The locked SKIN being tried on right now, or `null`.
 *
 * Self-healing: a try-on of something that became owned (bought on this device
 * or pulled in from another one) simply ends — you are looking at your own
 * character again, and there is nothing to buy.
 */
function previewDefOf(game: GameState): SkinDef | null {
  if (!previewCharacter) return null;
  const skin = skinById(previewCharacter);
  if (!skin || ownsSkin(game, skin.id)) {
    previewCharacter = null;
    return null;
  }
  return skin;
}

/** The confirmation sheet of a pending purchase ('' when nothing is pending). */
function buySheet(game: GameState): string {
  if (!pendingCharacter) return '';
  const skin = skinById(pendingCharacter);
  if (!skin || ownsSkin(game, skin.id)) return '';
  const previewing = previewDefOf(game)?.id === skin.id;
  const coins = game.battle.coins;
  const missing = Math.max(0, skin.cost - coins);
  const affordable = missing === 0;
  return `
    <div class="chr-buy" id="chrBuy" role="group" aria-label="אישור רכישת דמות">
      <div class="chr-buy-head">
        <b>${esc(skin.he)}</b>
        <span>${esc(skin.note)}</span>
      </div>
      <p class="chr-buy-price">מחיר: <b>🪙 ${skin.cost}</b> · יש לכם: <b>🪙 ${fmtXp(coins)}</b></p>
      <div class="chr-buy-try">
        ${
          previewing
            ? '<button class="eq-btn on" data-exit-preview="1">↩ חזרה לדמות שלי</button>'
            : `<button class="eq-btn" data-preview-character="${skin.id}">👁 תצוגה מקדימה</button>`
        }
      </div>
      <p class="gc-note dim">התצוגה המקדימה מלבישה את המראה הזה על הגוף, הרמות והציוד שלכם — בלי לרכוש ובלי לשנות דבר.</p>
      <div class="chr-buy-actions">
        <button class="eq-btn buy" data-buy-character="${skin.id}" ${affordable ? '' : 'disabled'}>
          ${affordable ? `🪙 ${skin.cost} · קנייה` : `חסרים 🪙 ${missing}`}
        </button>
        <button class="eq-btn off" data-cancel-character="1">ביטול</button>
      </div>
      ${
        affordable
          ? '<p class="gc-note dim">המראה ייפתח לתמיד — בשני הגופים — וייבחר מיד. אין לכך שום השפעה על הסטטיסטיקות.</p>'
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

  // THE TRY-ON: while a locked skin is being previewed the big drawing — and
  // ONLY the big drawing — wears it, on the player's real body, with their real
  // levels and equipment. Nothing is written; `game.characters.selected` is
  // untouched, so the arena (and every other reader of the store) still sees the
  // real choice.
  const preview = previewDefOf(game);
  const previewId = preview ? characterId(preview.id, selectedBody(game)) : '';
  const previewHe = previewId ? (characterById(previewId)?.he ?? preview?.he ?? '') : '';

  main.innerHTML = `
  <section class="char-card">
    <div class="char-stage ${preview ? 'previewing' : ''}">
      ${characterSvg(game.parts, {
        pulse,
        equipment: game.equipment,
        trophies,
        character: preview ? previewId : game.characters.selected,
        ...(preview ? { label: `תצוגה מקדימה: ${previewHe}` } : {}),
      })}
      <div class="char-level" aria-label="רמת דמות">
        <span class="cl-num">${game.level}</span><span class="cl-lbl">רמה</span>
      </div>
      ${tier > 0 && !preview ? `<div class="char-streak-chip">🔥 דרגה ${tier} · +${tier * 10}%</div>` : ''}
      ${
        preview
          ? `<div class="char-preview" id="chrPreview">
              <span class="cp-chip">👁 תצוגה מקדימה — לא נרכש</span>
              <button class="eq-btn on cp-back" type="button" data-exit-preview="1">↩ חזרה לדמות שלי</button>
            </div>`
          : ''
      }
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

  // THE BODY TOGGLE. Free, instant, and a plain `character_selected` under the
  // hood: the same skin on the other silhouette. Everything on the screen — the
  // big drawing, every card preview, the arena next time it opens — follows,
  // because they all render `selected`.
  main.querySelectorAll<HTMLButtonElement>('[data-body-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = btn.dataset['bodySelect'] as BodyGeometry | undefined;
      if (!body) return;
      selectBody(deps.store, body);
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('.chr-card[data-skin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const skinId = btn.dataset['skin'];
      if (!skinId) return;
      const game = gameOf(deps.store);
      if (ownsSkin(game, skinId)) {
        // Owned: wear it on the body being played — the big drawing is the feedback.
        pendingCharacter = null;
        previewCharacter = null; // an owned skin is worn for real, not tried on
        const id = characterId(skinId, selectedBody(game));
        if (selectCharacter(deps.store, id)) toast(`${characterById(id)?.he ?? 'הדמות'} נכנסה לזירה! ✨`);
        refresh();
        return;
      }
      // Locked: never buy on the first tap — open the confirmation sheet.
      pendingCharacter = skinId;
      // Opening ANOTHER locked skin's sheet ends the previous try-on, so the
      // chip and the drawing can never disagree about who is on stage.
      if (previewCharacter !== skinId) previewCharacter = null;
      refresh();
    });
  });

  // Try-on: pure view state — no event, no store write, no `selectCharacter`.
  // The sheet stays open underneath, so buying from the preview is one tap.
  main.querySelectorAll<HTMLButtonElement>('[data-preview-character]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['previewCharacter'];
      if (!id || ownsSkin(gameOf(deps.store), id)) return;
      previewCharacter = id;
      pendingCharacter = id;
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-exit-preview]').forEach((btn) => {
    btn.addEventListener('click', () => {
      previewCharacter = null;
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-buy-character]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const skinId = btn.dataset['buyCharacter'];
      if (!skinId) return;
      const res = buyCharacter(deps.store, skinId);
      if (!res.ok) {
        toast(
          res.error === 'insufficient_coins'
            ? 'אין מספיק מטבעות — נצחו עוד גלים או בוס עולם. 🪙'
            : 'לא ניתן לרכוש את הדמות הזו.',
        );
        return;
      }
      pendingCharacter = null;
      previewCharacter = null; // bought: the drawing is the real character now
      toast(`${skinById(skinId)?.he ?? 'הדמות'} נרכשה — בשני הגופים! 🎭`);
      refresh();
    });
  });

  main.querySelectorAll<HTMLButtonElement>('[data-cancel-character]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingCharacter = null;
      previewCharacter = null;
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
