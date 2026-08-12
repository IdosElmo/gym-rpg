/**
 * core/ghost.ts — THE GHOST DUEL: another account's character, as an opponent.
 *
 * PURE, like every other module in `core/`: no DOM, no storage, no network and
 * no `Date.now()`. It turns a snapshot of somebody's character (the "ghost")
 * into a one-enemy gauntlet the existing battle engine can fight, and it is the
 * ONLY place a fetched payload is allowed to become numbers.
 *
 * WHAT A GHOST IS
 * ---------------
 * A tiny versioned snapshot — six body-part levels, the streak tier, the worn
 * equipment and its upgrade levels, and the body × skin being played. That is
 * exactly the input `deriveStats` needs, so the opponent is built by the SAME
 * pipeline the live player is: no second stat model, no "enemy" curve, no way
 * for the two sides to drift apart. There is no workout history in it, no
 * email, no user id — a ghost is what your character LOOKS and FIGHTS like,
 * nothing about the person behind it.
 *
 * NEVER TRUST THE ROW
 * -------------------
 * `ghosts` is readable by every signed-in user (that is the sharing mechanism —
 * see `supabase/schema.sql`), so ANY authenticated client can write whatever it
 * likes into its own row and hand it to us. `normalizeGhost` is therefore a hard
 * boundary, not a formality: an unknown `v` is rejected outright, every level is
 * clamped into 1…`maxLevel`, the streak tier into 0…`maxStreakTier`, item ids
 * must exist AND belong to the slot they claim, upgrade levels are clamped to
 * the real +0…+3 curve, and the skin/body must be real roster values. The
 * character level is DERIVED from the clamped levels rather than believed, so a
 * row cannot advertise a level its own stats do not back up. Nothing a hostile
 * row can say makes the game grant anything: a duel pays no coins at all.
 *
 * THE SAME FIGHT FOR BOTH SIDES
 * -----------------------------
 * The seed is `FNV-1a('duel|<sorted handles>|<date>')` — the two handles SORTED,
 * so "A duels B" and "B duels A" are the same number on the same day, and a duel
 * can be talked about ("I beat you 3 times") rather than re-rolled until it goes
 * your way. The seed changes tomorrow, which is what makes it one duel per pair
 * per day rather than one for ever.
 *
 * THE GHOST DOES NOT PLAY (v1)
 * ----------------------------
 * It auto-attacks on its real interval, mitigates with its real DEF, crits with
 * its real crit stats and regenerates with its real Core — but it never taps and
 * never fires a skill, because nobody is holding it. That is a deliberate,
 * documented asymmetry: the live player has six abilities, a super meter and
 * their hands, the ghost has the stats its owner trained. It keeps the duel
 * deterministic (a script, not a second AI) and it keeps it winnable against a
 * stronger character — which is the whole point of bragging rights.
 */

import { BALANCE } from './balance.ts';
import { hashSeed, type ChallengeOpponent, type ChallengeRun, type GauntletWave } from './combat.ts';
import { hashString } from './daily.ts';
import { checkHandle, normalizeHandle } from './handle.ts';
import { characterLevel, deriveStats, type CharacterStats } from './xp.ts';
import { clampUpgradeLevel, upgradeMultiplier } from './upgrades.ts';
import {
  BODY_GEOMETRIES,
  DEFAULT_BODY,
  DEFAULT_SKIN_ID,
  characterId,
  skinById,
  type BodyGeometry,
} from '../data/characters.ts';
import {
  EQUIPMENT_SLOTS,
  equipmentById,
  sumEquipBonus,
  type EquipmentSlot,
} from '../data/gameContent.ts';
import { BODY_PARTS, type BodyPart } from '../data/program.ts';
import type { GameState, PartsProgress } from '../storage/DataStore.ts';

/* ----------------------------------------------------------- the payload */

/** Bump when the SHAPE below changes; an unknown version is rejected, not guessed. */
export const GHOST_VERSION = 1;

/**
 * The published snapshot. Minimal on purpose: everything here is needed to draw
 * the character and to derive its stats, and NOTHING else is in it — no workout
 * history, no dates, no email, no user id, no coins.
 */
export interface GhostPayload {
  v: typeof GHOST_VERSION;
  /** Display name — the handle in its canonical form. */
  name: string;
  body: BodyGeometry;
  /** SKIN id (`'hero'`, `'robot'`), not a combination id. */
  skin: string;
  /** The six body-part LEVELS (never the XP behind them). */
  parts: Record<BodyPart, number>;
  streakTier: number;
  equipped: Partial<Record<EquipmentSlot, string>>;
  /** item id -> +0…+3. */
  upgrades: Record<string, number>;
  /** Derived from `parts`; carried so a preview needs no arithmetic. */
  characterLevel: number;
  /**
   * DEV MODE, declared. Present (and always `true`) while the owner's save
   * carries a dev grant that has not been purged — see `GameState.devUsed`.
   *
   * It is here for one reason: an opponent has the right to know that the
   * character they are about to fight was partly handed out rather than trained.
   * The duel card shows a small 🛠 next to their name. It is a LABEL and nothing
   * else — it changes no stat, no seed and no reward (a duel pays nothing
   * anyway), so an honest client that hides it gains nothing by hiding it. It
   * disappears by itself once the owner purges their grants.
   */
  dev?: true;
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The levels of the six parts, as `deriveStats` wants them (XP is irrelevant). */
function partsProgressOf(levels: Record<BodyPart, number>): PartsProgress {
  const out = {} as PartsProgress;
  for (const p of BODY_PARTS) out[p] = { xp: 0, level: levels[p] };
  return out;
}

/**
 * Build MY ghost from my own game state. The only place a payload is created.
 *
 * It reads the same fields the character screen draws from, so "what other
 * people fight" is by construction "what I am playing right now".
 */
export function buildGhost(game: GameState, handle: string): GhostPayload {
  const name = normalizeHandle(handle);
  const parts = {} as Record<BodyPart, number>;
  for (const p of BODY_PARTS) parts[p] = clampInt(game.parts[p].level, 1, BALANCE.xp.maxLevel, 1);

  const equipped: Partial<Record<EquipmentSlot, string>> = {};
  const upgrades: Record<string, number> = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const id = game.equipment.equipped[slot];
    const def = id ? equipmentById(id) : undefined;
    if (!def || def.slot !== slot) continue;
    equipped[slot] = def.id;
    const level = clampUpgradeLevel(game.equipment.upgrades[def.id]);
    if (level > 0) upgrades[def.id] = level;
  }

  const char = game.characters.selected;
  const skin = skinById(char.split('_')[0] ?? '') ? (char.split('_')[0] as string) : DEFAULT_SKIN_ID;
  const body: BodyGeometry = char.endsWith('_f') ? 'female' : DEFAULT_BODY;

  return {
    v: GHOST_VERSION,
    name,
    body,
    skin,
    parts,
    streakTier: clampInt(game.streak.tier, 0, BALANCE.duel.maxStreakTier, 0),
    equipped,
    upgrades,
    characterLevel: characterLevel(partsProgressOf(parts)),
    // Declared only while it is TRUE, so a save that never used dev mode
    // publishes exactly the payload it always did — and a purge removes the
    // field again, which `ghostHash` notices and republishes.
    ...(game.devUsed ? { dev: true as const } : {}),
  };
}

/**
 * THE trust boundary: any row, from anywhere, to a payload the game can hold —
 * or `null`.
 *
 * Every field is either recognised or replaced; nothing is believed. See the
 * module header for why this is load bearing.
 */
export function normalizeGhost(raw: unknown): GhostPayload | null {
  if (!isRecord(raw)) return null;
  if (clampInt(raw['v'], 0, 1_000_000, 0) !== GHOST_VERSION) return null;

  const name = normalizeHandle(raw['name']);
  if (!checkHandle(name).ok) return null;

  const partsRaw = isRecord(raw['parts']) ? raw['parts'] : {};
  const parts = {} as Record<BodyPart, number>;
  for (const p of BODY_PARTS) parts[p] = clampInt(partsRaw[p], 1, BALANCE.xp.maxLevel, 1);

  const equippedRaw = isRecord(raw['equipped']) ? raw['equipped'] : {};
  const equipped: Partial<Record<EquipmentSlot, string>> = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const id = equippedRaw[slot];
    const def = typeof id === 'string' ? equipmentById(id) : undefined;
    // The slot has to agree too: a "cape" that is really a pair of gloves would
    // otherwise let one account wear four capes' worth of bonuses.
    if (def && def.slot === slot) equipped[slot] = def.id;
  }

  const upgradesRaw = isRecord(raw['upgrades']) ? raw['upgrades'] : {};
  const upgrades: Record<string, number> = {};
  for (const [id, level] of Object.entries(upgradesRaw)) {
    if (!equipmentById(id)) continue;
    const lv = clampUpgradeLevel(level);
    if (lv > 0) upgrades[id] = lv;
  }

  const skinRaw = typeof raw['skin'] === 'string' ? raw['skin'] : '';
  const skin = skinById(skinRaw)?.id ?? DEFAULT_SKIN_ID;
  const bodyRaw = raw['body'];
  const body: BodyGeometry =
    typeof bodyRaw === 'string' && (BODY_GEOMETRIES as readonly string[]).includes(bodyRaw)
      ? (bodyRaw as BodyGeometry)
      : DEFAULT_BODY;

  return {
    v: GHOST_VERSION,
    name,
    body,
    skin,
    parts,
    streakTier: clampInt(raw['streakTier'], 0, BALANCE.duel.maxStreakTier, 0),
    equipped,
    upgrades,
    // DERIVED, never believed: the row may not claim a level its levels do not
    // add up to.
    characterLevel: characterLevel(partsProgressOf(parts)),
    // A row may only ever ADD this flag to itself; there is nothing to gain by
    // lying in either direction, and nothing downstream reads it but a label.
    ...(raw['dev'] === true ? { dev: true as const } : {}),
  };
}

/** The roster id (`'robot_f'`) a ghost is drawn with. */
export function ghostCharacterId(ghost: GhostPayload): string {
  return characterId(ghost.skin, ghost.body);
}

/**
 * The ghost's combat stats — through `deriveStats`, exactly like the player's.
 *
 * Same order of operations too (gear adds, streak multiplies the sum), because
 * this IS the player's function: the only difference between the two sides of a
 * duel is whose numbers went in.
 */
export function ghostStats(ghost: GhostPayload): CharacterStats {
  const ids = EQUIPMENT_SLOTS.map((slot) => ghost.equipped[slot]).filter(
    (id): id is string => typeof id === 'string',
  );
  const bonus = sumEquipBonus(ids, (id) => upgradeMultiplier(ghost.upgrades[id] ?? 0));
  return deriveStats(partsProgressOf(ghost.parts), ghost.streakTier, bonus);
}

/**
 * A stable fingerprint of a payload — the "did anything change?" test the
 * publisher uses so an unchanged snapshot is never re-uploaded.
 *
 * Built from a CANONICAL serialisation (fixed field order, sorted maps), so two
 * runs of the app hash the same character to the same string even though
 * `JSON.stringify` of a rebuilt object could order its keys differently.
 */
export function ghostHash(ghost: GhostPayload): string {
  const parts = BODY_PARTS.map((p) => `${p}:${ghost.parts[p]}`).join(',');
  const equipped = EQUIPMENT_SLOTS.map((s) => `${s}:${ghost.equipped[s] ?? ''}`).join(',');
  const upgrades = Object.keys(ghost.upgrades)
    .sort()
    .map((id) => `${id}:${ghost.upgrades[id]}`)
    .join(',');
  const canonical = [
    `v${ghost.v}`,
    ghost.name,
    ghost.body,
    ghost.skin,
    parts,
    `t${ghost.streakTier}`,
    equipped,
    upgrades,
    // The 🛠 flag is part of the snapshot's identity: turning it on (a first dev
    // grant) or off (a purge) has to republish, or opponents would keep seeing
    // yesterday's label.
    ghost.dev === true ? 'dev' : '',
  ].join('|');
  return hashString(canonical).toString(36);
}

/* -------------------------------------------------------------- the duel */

/**
 * THE seed of one duel: a hash of the two handles SORTED plus the date.
 *
 * Sorting is what makes it symmetric — the same pair on the same day get one
 * fight, whoever pressed the button — and the date is what stops it being the
 * same fight for ever.
 */
export function duelSeed(a: string, b: string, date: string): number {
  const pair = [normalizeHandle(a), normalizeHandle(b)].sort();
  return hashSeed(hashString(`duel|${pair[0] ?? ''}|${pair[1] ?? ''}|${date}`));
}

export interface GhostWaveArgs {
  ghost: GhostPayload;
  /** The opponent's character SVG — built by the UI, which owns the drawing. */
  svg?: string;
}

/**
 * The ghost as ONE gauntlet wave.
 *
 * `coins: 0` is the economy, in a single field: two accounts in one household
 * could otherwise farm each other for ever, so a duel pays exactly nothing but
 * the record. The defensive stats ride along on the wave (`def`, `critChance`,
 * `critMultiplier`, `regen`), which is what makes the ghost a CHARACTER rather
 * than a hit-point bag — see `core/combat.ts`, where an enemy without them
 * behaves byte-for-byte as it always did.
 */
export function ghostWave(a: GhostWaveArgs): GauntletWave {
  const stats = ghostStats(a.ghost);
  return {
    index: 1,
    // Cosmetic only (the backdrop) — a duel frames itself in violet anyway.
    world: 1,
    miniBoss: false,
    enemyId: `ghost:${a.ghost.name}`,
    he: a.ghost.name,
    svg: a.svg ?? '',
    hp: Math.max(1, Math.round(stats.maxHp)),
    atk: Math.max(1, Math.round(stats.atk * 10) / 10),
    attackIntervalMs: stats.attackIntervalMs,
    coins: 0,
    def: stats.def,
    critChance: stats.critChance,
    critMultiplier: stats.critMultiplier,
    regen: stats.regen,
  };
}

export interface GhostRunArgs {
  /** My published handle — half of the seed. */
  myHandle: string;
  /** The handle that was looked up (the ledger key uses this). */
  opponentHandle: string;
  ghost: GhostPayload;
  date: string;
  svg?: string;
}

/** The opponent card's data — display only, carried through the run. */
export function ghostOpponent(handle: string, ghost: GhostPayload): ChallengeOpponent {
  return {
    handle: normalizeHandle(handle),
    name: ghost.name,
    characterId: ghostCharacterId(ghost),
    level: ghost.characterLevel,
  };
}

/**
 * The shape `createChallengeBattle` wants — a duel as a battle context.
 *
 * One wave, no completion bonus, no healing between waves (there is no between),
 * and the challenge's `date` is the duel's date: together with the opponent
 * handle it is the idempotency key of the single `ghost_duel` event.
 */
export function ghostRun(
  a: GhostRunArgs,
): Omit<ChallengeRun, 'index' | 'cleared' | 'coins' | 'outcome'> {
  return {
    kind: 'ghost',
    date: a.date,
    seed: duelSeed(a.myHandle, a.opponentHandle, a.date),
    waves: [ghostWave({ ghost: a.ghost, ...(a.svg === undefined ? {} : { svg: a.svg }) })],
    energyCost: BALANCE.duel.entryEnergy,
    completionBonus: 0,
    healOnWaveClear: 0,
    spawnDelayMs: BALANCE.duel.spawnDelayMs,
    opponent: ghostOpponent(a.opponentHandle, a.ghost),
  };
}
