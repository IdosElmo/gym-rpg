/**
 * i18n/gameText.ts — the GAME content in the reader's language: worlds,
 * enemies, bosses, equipment, slots, skills, skins and bodies.
 *
 * Same contract as `i18n/content.ts` for the program: the data files stay
 * Hebrew, names that already sit beside an English one go through `pick`, and
 * everything else comes from the overlay in `content/gameContent.en.ts`, keyed
 * by stable id. In Hebrew every accessor returns the field itself (byte for
 * byte what the screens printed before), and in English a missing overlay
 * entry falls back to the Hebrew original.
 *
 * PRESENTATION ONLY. Nothing here may be called by a reducer or end up in an
 * event payload or the GameState — a combat enemy keeps its Hebrew `he` in
 * state, and the screen localizes it on paint (`foeName`).
 */

import { skillFigures, skillSummaryHe } from '../core/combat.ts';
import {
  BODY_HE,
  skinById,
  type BodyGeometry,
  type CharacterDef,
  type SkinDef,
} from '../data/characters.ts';
import {
  SLOT_HE,
  bonusHe,
  enemyById,
  type EquipBonus,
  type EquipmentDef,
  type EquipmentSlot,
  type SkillDef,
  type WorldDef,
} from '../data/gameContent.ts';
import {
  BODY_EN,
  EQUIPMENT_NOTE_EN,
  SKILL_EN,
  SKIN_NOTE_EN,
  SLOT_EN,
  WORLD_TAGLINE_EN,
} from './content/gameContent.en.ts';
import { locale, pick } from './locale.ts';

const isEn = (): boolean => locale() === 'en';

/* ------------------------------------------------------------- worlds */

/** "חדר כושר נטוש" / "Abandoned Gym". */
export function worldName(w: WorldDef): string {
  return pick(w);
}

/** The flavour line under a world's name in the arena. */
export function worldTagline(w: WorldDef): string {
  return isEn() ? (WORLD_TAGLINE_EN[w.id] ?? w.tagline) : w.tagline;
}

/* ------------------------------------------------------------ enemies */

/** A content enemy or boss definition's name. */
export function enemyName(def: { readonly he: string; readonly en: string }): string {
  return pick(def);
}

/**
 * The name of whatever is standing in the arena, from its RUNTIME state
 * (`EnemyState`, a gauntlet wave, …) — which carries the content id and the
 * Hebrew name only, because state never holds a translation. A ghost is a
 * PERSON: its name is whatever handle they chose, in any language.
 */
export function foeName(e: { readonly id?: string; readonly enemyId?: string; readonly he: string; readonly ghost?: boolean }): string {
  if (e.ghost === true || !isEn()) return e.he;
  const def = enemyById(e.id ?? e.enemyId ?? '');
  return def ? pick(def) : e.he;
}

/* ---------------------------------------------------------- equipment */

export function itemName(def: EquipmentDef): string {
  return pick(def);
}

/** The shop card's flavour line. */
export function itemNote(def: EquipmentDef): string {
  return isEn() ? (EQUIPMENT_NOTE_EN[def.id] ?? def.note) : def.note;
}

export function slotName(slot: EquipmentSlot): string {
  return isEn() ? SLOT_EN[slot] : SLOT_HE[slot];
}

/** An item's bonus as one line: "+11 התקפה · +3% קריטי" / "+11 ATK · +3% crit". */
export function bonusText(b: EquipBonus): string {
  if (!isEn()) return bonusHe(b);
  const parts: string[] = [];
  if (b.atk) parts.push(`+${b.atk} ATK`);
  if (b.def) parts.push(`+${b.def} DEF`);
  if (b.hp) parts.push(`+${b.hp} HP`);
  if (b.attackIntervalMs) {
    parts.push(`${b.attackIntervalMs < 0 ? '−' : '+'}${Math.abs(b.attackIntervalMs) / 1000}s speed`);
  }
  if (b.critChance) parts.push(`+${Math.round(b.critChance * 100)}% crit`);
  if (b.critMultiplier) parts.push(`+${Math.round(b.critMultiplier * 100)}% crit dmg`);
  if (b.regen) parts.push(`+${b.regen} regen`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------- skills */

export function skillName(def: SkillDef): string {
  return isEn() ? (SKILL_EN[def.id]?.name ?? def.he) : def.he;
}

/** Flavour without numbers (the locked-slot toast). */
export function skillDesc(def: SkillDef): string {
  return isEn() ? (SKILL_EN[def.id]?.desc ?? def.desc) : def.desc;
}

/** The skill's sentence with its numbers resolved at `power` (from BALANCE). */
export function skillSummary(def: SkillDef, power = 1): string {
  if (!isEn()) return skillSummaryHe(def, power);
  const f = skillFigures(def, power);
  if (!f) return '';
  switch (f.id) {
    case 'smash':
      return `${f.mult}× your attack, in a single blow.`;
    case 'guard':
      return `${f.secs}s of guard — incoming damage cut by ${f.pct}%.`;
    case 'quake':
      return `${f.mult}× damage and stuns the enemy for ${f.secs}s.`;
    case 'flurry':
      return `${f.secs}s of double attack speed.`;
    case 'focus':
      return `Your next attack is a guaranteed crit, with +${f.pct}% crit damage.`;
    case 'breath':
      return `Instantly heals ${f.pct}% HP, then ${f.secs}s of boosted recovery.`;
  }
}

/* ---------------------------------------------------- skins and bodies */

/** A skin's card name ("רובוט" / "Training Robot"). */
export function skinName(skin: SkinDef): string {
  return pick(skin);
}

/** A skin's tag line on the purchase sheet. */
export function skinNote(skin: SkinDef): string {
  return isEn() ? (SKIN_NOTE_EN[skin.id] ?? skin.note) : skin.note;
}

/**
 * One playable combination's name. Hebrew names each body's look separately
 * ("רובוט מתאמן" / "רובוטית מתאמנת") because the language is gendered; English
 * is not, so both bodies share the skin's name.
 */
export function characterName(def: CharacterDef): string {
  if (!isEn()) return def.he;
  return skinById(def.skin)?.en ?? def.en;
}

/** "גבר" / "Male". */
export function bodyName(b: BodyGeometry): string {
  return isEn() ? BODY_EN[b] : BODY_HE[b];
}
