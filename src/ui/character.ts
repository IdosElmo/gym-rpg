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

import { BODY_PARTS, type BodyPart } from '../data/program.ts';
import {
  BODY_EMOJI,
  BODY_GEOMETRIES,
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
  bossById,
  equipmentById,
  equipmentForSlot,
  worldById,
  type EquipmentSlot,
} from '../data/gameContent.ts';
import {
  buyCharacter,
  buyItem,
  equipItem,
  gameOf,
  selectBody,
  selectCharacter,
  upgradeItem,
} from '../core/game.ts';
import { levelProgress, ownsSkin, selectedBody, selectedCharacter, statsOfGame } from '../core/xp.ts';
import {
  MAX_UPGRADE_LEVEL,
  nextUpgradeCost,
  upgradeLabel,
  upgradeLevelOf,
  upgradeMultiplier,
  upgradeStars,
  upgradedBonus,
} from '../core/upgrades.ts';
import type { DataStore, GameState } from '../storage/DataStore.ts';
import { characterSvg, trophyMedallion } from './characterSvg.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { fmtXp } from './xpfx.ts';
import { tr } from '../i18n/locale.ts';
import { character as M } from '../i18n/messages/character.ts';
import { bodyPartName } from '../i18n/content.ts';
import {
  bodyName,
  bonusText,
  characterName,
  enemyName,
  itemName,
  itemNote,
  skinName,
  skinNote,
  slotName,
  worldName,
} from '../i18n/gameText.ts';

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

const PART_EMOJI: Readonly<Record<BodyPart, string>> = {
  chest: '🛡',
  back: '🪖',
  legs: '❤️',
  shoulders: '⚡',
  arms: '💥',
  core: '♻️',
};

/* ------------------------------------------------------------------ shop */

/**
 * The UPGRADE control of one owned item: a priced button, a shortfall hint, or
 * the ⭐ מקסימלי mark at +3.
 *
 * The price comes from the same pure function the reducer's plan does
 * (`nextUpgradeCost`), so what the button says is exactly what will be charged,
 * and an unaffordable one says how many coins are MISSING rather than failing
 * silently on tap — the same courtesy the character purchase sheet extends.
 */
function upgradeControl(game: GameState, itemId: string, level: number): string {
  const T = tr(M).shop;
  if (level >= MAX_UPGRADE_LEVEL) {
    return `<span class="eq-max" data-maxed="${itemId}">${T.max}</span>`;
  }
  const cost = nextUpgradeCost(itemId, level);
  const missing = Math.max(0, cost - game.battle.coins);
  return `<button class="eq-btn up" data-upgrade="${itemId}" ${missing > 0 ? 'disabled' : ''}
    aria-label="${esc(T.upgradeLabel(upgradeLabel(level + 1)))}">
    ${missing > 0 ? T.missing(missing) : T.upgrade(cost)}
  </button>`;
}

function slotCard(game: GameState, slot: EquipmentSlot): string {
  const T = tr(M).shop;
  const wornId = game.equipment.equipped[slot];
  const worn = wornId ? equipmentById(wornId) : undefined;
  const wornLevel = wornId ? upgradeLevelOf(game.equipment, wornId) : 0;
  const open = openSlot === slot;
  const items = equipmentForSlot(slot)
    .map((item) => {
      const owned = game.equipment.owned.includes(item.id);
      const equipped = wornId === item.id;
      const affordable = game.battle.coins >= item.cost;
      const level = upgradeLevelOf(game.equipment, item.id);
      const action = equipped
        ? `<button class="eq-btn off" data-unequip="${slot}">${T.unequip}</button>`
        : owned
          ? `<button class="eq-btn on" data-equip="${item.id}">${T.equip}</button>`
          : `<button class="eq-btn buy" data-buy="${item.id}" ${affordable ? '' : 'disabled'}>
               🪙 ${item.cost}
             </button>`;
      // An owned item shows the level it is AT and what the next one costs; an
      // unowned one shows nothing about upgrades at all — you upgrade gear you
      // own, and a shop row that talked about both would just be noise.
      const badge = owned
        ? `<span class="eq-up up-${level}" data-level="${item.id}">${upgradeLabel(level)}${
            level > 0 ? ` ${upgradeStars(level)}` : ''
          }</span>`
        : '';
      return `<li class="eq-item ${equipped ? 'equipped' : owned ? 'owned' : ''} ${affordable || owned ? '' : 'poor'} ${
        level > 0 ? `upgraded up-${level}` : ''
      }" data-item="${item.id}">
        <span class="eq-art" aria-hidden="true">${item.icon}</span>
        <span class="eq-body">
          <b>${esc(itemName(item))} <span class="eq-tier">${T.tier(item.tier)}</span> ${badge}</b>
          <span class="eq-bonus">${esc(bonusText(upgradedBonus(item, level)))}</span>
          <span class="eq-note">${esc(itemNote(item))}</span>
        </span>
        <span class="eq-actions">${action}${owned ? upgradeControl(game, item.id, level) : ''}</span>
      </li>`;
    })
    .join('');

  return `<section class="eq-slot ${open ? 'open' : ''}">
    <button class="eq-head" data-slot-toggle="${slot}" aria-expanded="${open}">
      <span class="eq-slot-name">${SLOT_EMOJI[slot]} ${slotName(slot)}</span>
      <span class="eq-worn">${worn ? `${esc(itemName(worn))}${wornLevel > 0 ? ` ${upgradeLabel(wornLevel)}` : ''}` : T.empty}</span>
      <span class="eq-caret" aria-hidden="true">${open ? '▲' : '▼'}</span>
    </button>
    ${open ? `<ul class="eq-list">${items}</ul>` : ''}
  </section>`;
}

function shopCard(game: GameState): string {
  const T = tr(M).shop;
  const worn = EQUIPMENT_SLOTS.filter((s) => game.equipment.equipped[s]).length;
  return `
  <section class="game-card" id="shopCard">
    <h3 class="gc-title">${T.title} <span class="gc-sub">${T.sub(fmtXp(game.battle.coins), worn, EQUIPMENT_SLOTS.length)}</span></h3>
    <div class="eq-slots">${EQUIPMENT_SLOTS.map((s) => slotCard(game, s)).join('')}</div>
    <p class="gc-note">${T.note}</p>
    <p class="gc-note dim">${T.upgradeNote(upgradeLabel(MAX_UPGRADE_LEVEL), upgradeMultiplier(MAX_UPGRADE_LEVEL))}</p>
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
  const T = tr(M).roster;

  const bodies = BODY_GEOMETRIES.map((b) => {
    const on = b === body;
    return `<button class="chr-body ${on ? 'on' : ''}" type="button" data-body-select="${b}"
      aria-pressed="${on ? 'true' : 'false'}">
      <span aria-hidden="true">${BODY_EMOJI[b]}</span> ${bodyName(b)}
    </button>`;
  }).join('');

  const cards = SKINS.map((s) => {
    const owned = ownsSkin(game, s.id);
    const isSelected = owned && s.id === currentSkin;
    const affordable = coins >= s.cost;
    const previewing = preview?.id === s.id;
    const id = characterId(s.id, body);
    const def = characterById(id);
    const tag = previewing ? T.previewing : isSelected ? T.selected : owned ? T.unlocked : `🪙 ${s.cost}`;
    const state =
      (isSelected ? 'selected' : owned ? 'owned' : affordable ? 'locked' : 'locked poor') +
      (previewing ? ' previewing' : '');
    const he = def ? characterName(def) : skinName(s);
    return `<li class="chr-item">
      <button class="chr-card ${state}" type="button" data-skin="${s.id}" data-character="${id}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
        aria-label="${esc(he)}${owned ? '' : T.costAria(s.cost)}">
        <span class="chr-art" aria-hidden="true">${characterSvg(game.parts, { character: id, label: he })}</span>
        <b class="chr-name">${esc(skinName(s))}</b>
        <span class="chr-tag">${tag}</span>
      </button>
    </li>`;
  }).join('');

  return `
  <section class="game-card" id="charRoster">
    <h3 class="gc-title">${T.title} <span class="gc-sub">${T.sub(unlocked, SKINS.length, fmtXp(coins))}</span></h3>
    <div class="chr-bodies" id="chrBodies" role="group" aria-label="${esc(T.bodiesLabel)}">${bodies}</div>
    <ul class="chr-row">${cards}</ul>
    ${buySheet(game)}
    <p class="gc-note">${T.note}</p>
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
  const T = tr(M).sheet;
  return `
    <div class="chr-buy" id="chrBuy" role="group" aria-label="${esc(T.label)}">
      <div class="chr-buy-head">
        <b>${esc(skinName(skin))}</b>
        <span>${esc(skinNote(skin))}</span>
      </div>
      <p class="chr-buy-price">${T.price(skin.cost, fmtXp(coins))}</p>
      <div class="chr-buy-try">
        ${
          previewing
            ? `<button class="eq-btn on" data-exit-preview="1">${T.back}</button>`
            : `<button class="eq-btn" data-preview-character="${skin.id}">${T.preview}</button>`
        }
      </div>
      <p class="gc-note dim">${T.previewNote}</p>
      <div class="chr-buy-actions">
        <button class="eq-btn buy" data-buy-character="${skin.id}" ${affordable ? '' : 'disabled'}>
          ${affordable ? T.buy(skin.cost) : T.missing(missing)}
        </button>
        <button class="eq-btn off" data-cancel-character="1">${T.cancel}</button>
      </div>
      ${
        affordable
          ? `<p class="gc-note dim">${T.buyNote}</p>`
          : `<p class="gc-note dim">${T.missingNote(missing)}</p>`
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
        ${trophyMedallion(boss, worldName(world))}
        <b>${esc(enemyName(boss))}</b>
        <span>${esc(worldName(world))}</span>
      </li>`;
    })
    .join('');

  const T = tr(M).trophies;
  return `
  <section class="game-card">
    <h3 class="gc-title">${T.title} <span class="gc-sub">${T.sub(ids.length, game.battle.miniBossesCleared)}</span></h3>
    ${
      medals
        ? `<ul class="trophy-shelf">${medals}</ul>`
        : `<p class="gc-note">${T.empty}</p>`
    }
    <div class="char-meta trophy-meta">
      <div class="cm-item"><b>👑 ${game.battle.miniBossesCleared}</b><span>${T.minis}</span></div>
      <div class="cm-item"><b>⚔️ ${game.battle.wavesCleared}</b><span>${T.waves}</span></div>
      <div class="cm-item"><b>🏛 ${ids.length}</b><span>${T.bosses}</span></div>
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ view */

export function renderCharacter(main: HTMLElement, deps: CharacterDeps): void {
  const game = gameOf(deps.store);
  const stats = statsOfGame(game);
  const pulse = [...pendingPulse];
  pendingPulse.clear();
  const T = tr(M);

  const bars = BODY_PARTS.map((part) => {
    const p = levelProgress(game.parts[part].xp);
    const pct = Math.round(p.ratio * 100);
    return `
      <div class="part-row" data-part="${part}">
        <div class="part-head">
          <span class="part-name">${PART_EMOJI[part]} ${bodyPartName(part)}</span>
          <span class="part-level">${T.parts.level(p.level)}</span>
        </div>
        <div class="part-bar"><span style="width:${pct}%"></span></div>
        <div class="part-foot">
          <span class="part-role">${T.partRole[part]}</span>
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
  const previewDef = previewId ? characterById(previewId) : undefined;
  const previewHe = previewId ? (previewDef ? characterName(previewDef) : preview ? skinName(preview) : '') : '';

  main.innerHTML = `
  <section class="char-card">
    <div class="char-stage ${preview ? 'previewing' : ''}">
      ${characterSvg(game.parts, {
        pulse,
        equipment: game.equipment,
        trophies,
        character: preview ? previewId : game.characters.selected,
        ...(preview ? { label: T.stage.previewLabel(previewHe) } : {}),
      })}
      <div class="char-level" aria-label="${esc(T.stage.levelLabel)}">
        <span class="cl-num">${game.level}</span><span class="cl-lbl">${T.stage.level}</span>
      </div>
      ${tier > 0 && !preview ? `<div class="char-streak-chip">${T.stage.streakChip(tier, tier * 10)}</div>` : ''}
      ${
        preview
          ? `<div class="char-preview" id="chrPreview">
              <span class="cp-chip">${T.stage.previewChip}</span>
              <button class="eq-btn on cp-back" type="button" data-exit-preview="1">${T.sheet.back}</button>
            </div>`
          : ''
      }
    </div>
    <div class="char-meta">
      <div class="cm-item"><b>${fmtXp(game.totalXp)}</b><span>${T.stage.totalXp}</span></div>
      <div class="cm-item"><b>⚡ ${fmtXp(game.energy)}</b><span>${T.stage.energy}</span></div>
      <div class="cm-item"><b>🪙 ${fmtXp(game.battle.coins)}</b><span>${T.stage.coins}</span></div>
      <div class="cm-item"><b>🏆 ${game.prCount}</b><span>${T.stage.prs}</span></div>
    </div>
  </section>

  ${rosterCard(game)}

  <section class="game-card">
    <h3 class="gc-title">${T.power.title} <span class="gc-sub">${T.power.sub}</span></h3>
    <div class="stat-grid">
      <div class="stat"><span class="s-k">${T.stats.atk}</span><b>${stats.atk}</b></div>
      <div class="stat"><span class="s-k">${T.stats.def}</span><b>${stats.def}</b></div>
      <div class="stat"><span class="s-k">${T.stats.hp}</span><b>${stats.maxHp}</b></div>
      <div class="stat"><span class="s-k">${T.stats.speed}</span><b>${(stats.attackIntervalMs / 1000).toFixed(2)}s</b></div>
      <div class="stat"><span class="s-k">${T.stats.crit}</span><b>${Math.round(stats.critChance * 100)}%</b></div>
      <div class="stat"><span class="s-k">${T.stats.regen}</span><b>${stats.regen}</b></div>
    </div>
    <p class="gc-note">
      ${T.power.note(esc(worldName(worldById(game.battle.world))), game.battle.wave, game.battle.wavesCleared)}
    </p>
  </section>

  <section class="game-card">
    <h3 class="gc-title">${T.parts.title} <span class="gc-sub">${T.parts.sub}</span></h3>
    <div class="parts">${bars}</div>
  </section>

  <section class="game-card">
    <h3 class="gc-title">${T.streak.title} <span class="gc-sub">${T.streak.sub(game.streak.needed)}</span></h3>
    <div class="streak-row">
      <div class="streak-tier">
        <b>${tier}</b><span>${T.streak.tier}</span>
      </div>
      <div class="streak-body">
        <div class="part-bar streak"><span style="width:${streakPct}%"></span></div>
        <p class="gc-note">
          ${T.streak.week(game.streak.daysThisWeek, game.streak.needed, tier * 10)}
        </p>
        <p class="gc-note dim">${T.streak.rule(game.streak.needed)}</p>
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
        if (selectCharacter(deps.store, id)) {
          const def = characterById(id);
          toast(tr(M).toast.selected(def ? characterName(def) : tr(M).toast.heroFallback));
        }
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
            ? tr(M).toast.noCoins
            : tr(M).toast.cannotBuyCharacter,
        );
        return;
      }
      pendingCharacter = null;
      previewCharacter = null; // bought: the drawing is the real character now
      const skin = skinById(skinId);
      toast(tr(M).toast.boughtCharacter(skin ? skinName(skin) : tr(M).toast.heroFallback));
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

/** An item's name for a toast, or "the item" when the id is unknown. */
function itemLabel(id: string): string {
  const def = equipmentById(id);
  return def ? itemName(def) : tr(M).toast.itemFallback;
}

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
            ? tr(M).toast.noCoins
            : tr(M).toast.cannotBuyItem,
        );
        return;
      }
      toast(tr(M).toast.boughtItem(itemLabel(id)));
      refresh();
    });
  });

  // THE UPGRADE. One tap = one level, on an item you already own. The whole
  // screen re-renders, which is the point: the +N badge, the item's bonus line,
  // the stat grid one card above and the flair on the drawing all move together.
  main.querySelectorAll<HTMLButtonElement>('[data-upgrade]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['upgrade'];
      if (!id) return;
      const res = upgradeItem(deps.store, id);
      if (!res.ok) {
        toast(
          res.error === 'insufficient_coins'
            ? tr(M).toast.noCoinsUpgrade
            : res.error === 'max_level'
              ? tr(M).toast.maxed
              : tr(M).toast.cannotUpgrade,
        );
        return;
      }
      toast(tr(M).toast.upgraded(itemLabel(id), upgradeLabel(res.toLevel)));
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
