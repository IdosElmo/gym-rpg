/**
 * data/gameContent.ts — enemies, bosses, worlds and equipment definitions.
 *
 * PHASE 0 PLACEHOLDER — types + the four world names only.
 * Phases 2–3 fill in the enemy/boss rosters (Hebrew names + inline SVG sprites),
 * boss body-part gates and the equipment shop.
 */

import type { BodyPart } from './program.ts';

export interface WorldDef {
  readonly id: number;
  readonly he: string;
  readonly en: string;
}

/** The four launch worlds, per the brief. */
export const WORLDS: readonly WorldDef[] = [
  { id: 1, he: 'חדר כושר נטוש', en: 'Abandoned Gym' },
  { id: 2, he: 'הרחוב', en: 'The Street' },
  { id: 3, he: 'הזירה', en: 'The Arena' },
  { id: 4, he: 'הר האולימפוס', en: 'Mount Olympus' },
] as const;

export interface EnemyDef {
  readonly id: string;
  readonly he: string;
  readonly world: number;
  readonly hp: number;
  readonly atk: number;
  /** Inline SVG markup for the sprite (no external files — offline rule). */
  readonly svg: string;
}

export interface BossDef extends EnemyDef {
  /** Body-part levels required to challenge this boss. */
  readonly requires: Partial<Record<BodyPart, number>>;
}

export type EquipmentSlot = 'gloves' | 'belt' | 'shoes' | 'cape';

export interface EquipmentDef {
  readonly id: string;
  readonly he: string;
  readonly slot: EquipmentSlot;
  readonly cost: number;
  readonly svg: string;
}

// TODO(phase 2): ENEMIES per world. TODO(phase 3): BOSSES + gates, EQUIPMENT shop.
export const ENEMIES: readonly EnemyDef[] = [];
export const BOSSES: readonly BossDef[] = [];
export const EQUIPMENT: readonly EquipmentDef[] = [];
