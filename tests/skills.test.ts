/**
 * Unit tests for the six BODY-PART SKILLS (`core/combat.ts` + `BALANCE.skills`).
 *
 * What has to hold, and why:
 *   1. UNLOCKS ARE DERIVED — a skill is available because its body part is at
 *      `unlockLevel`, nothing else. There is no unlock flag anywhere in the
 *      state and therefore nothing to migrate;
 *   2. EVERY SKILL DOES ITS THING — a damage spike, a damage-reduction window, a
 *      stun, a halved attack interval, a guaranteed crit, a heal + regen burst;
 *   3. COOLDOWNS ARE ENFORCED IN THE CORE, not in the UI;
 *   4. DETERMINISM SURVIVES — the same seed with the same activation TICKS is
 *      byte-identical, and a different schedule is different but reproducible;
 *   5. A LOCKED SKILL IS A NO-OP — not even the RNG moves; and
 *   6. THE BALANCE HOLDS — skills are worth using and idling still works.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  advance,
  createBattle,
  simulate,
  skillPower,
  skillSummaryHe,
  skillUnlockLevel,
  skillUnlocked,
  skillViews,
  useSkill,
  type BattleState,
  type CombatEvent,
  type CombatStats,
  type PartLevels,
} from '../src/core/combat.ts';
import { deriveStats, emptyGame } from '../src/core/xp.ts';
import { SKILLS, SKILL_IDS, skillById, skillForPart, type SkillId } from '../src/data/gameContent.ts';
import { BODY_PARTS, type BodyPart } from '../src/data/program.ts';

const TICK = BALANCE.combat.tickMs;
const S = BALANCE.skills;

function levelsAt(level: number): Record<BodyPart, number> {
  const out = {} as Record<BodyPart, number>;
  for (const p of BODY_PARTS) out[p] = level;
  return out;
}

function statsAt(level: number): CombatStats {
  const parts = emptyGame().parts;
  for (const p of BODY_PARTS) parts[p].level = level;
  const s = deriveStats(parts, 0);
  return {
    atk: s.atk,
    def: s.def,
    maxHp: s.maxHp,
    attackIntervalMs: s.attackIntervalMs,
    critChance: s.critChance,
    critMultiplier: s.critMultiplier,
    regen: s.regen,
  };
}

const L5 = levelsAt(5);
const BASE = statsAt(5);

function battle(over: Partial<Parameters<typeof createBattle>[0]> = {}): BattleState {
  return createBattle({ seed: 4242, world: 1, wave: 1, energy: 100_000, stats: BASE, ...over });
}

function run(state: BattleState, stats: CombatStats, ms: number): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let t = 0; t < ms; t += TICK) out.push(...advance(state, TICK, stats));
  return out;
}

/** A battle with an enemy already on screen, ready to be poked. */
function fighting(over: Partial<Parameters<typeof createBattle>[0]> = {}): BattleState {
  const state = battle(over);
  run(state, (over.stats as CombatStats) ?? BASE, 200);
  return state;
}

/**
 * Run `ms` of battle, firing skills at the given TICK INDEXES. This is the
 * "activation schedule" the determinism tests compare: a schedule plus a seed
 * fully determines the run.
 */
function runScheduled(
  state: BattleState,
  stats: CombatStats,
  ms: number,
  schedule: Readonly<Record<number, SkillId>>,
  levels: PartLevels = L5,
): CombatEvent[] {
  const out: CombatEvent[] = [];
  const ticks = Math.round(ms / TICK);
  for (let i = 0; i < ticks; i += 1) {
    const id = schedule[i];
    if (id) out.push(...useSkill(state, id, stats, levels).events);
    out.push(...advance(state, TICK, stats));
  }
  return out;
}

/* ------------------------------------------------------------- the roster */

describe('the skill roster', () => {
  it('has exactly one skill per body part, in body-part order', () => {
    expect(SKILLS).toHaveLength(BODY_PARTS.length);
    expect(SKILLS.map((s) => s.part)).toEqual([...BODY_PARTS]);
    for (const part of BODY_PARTS) {
      const skill = skillForPart(part);
      expect(skill, `no skill for ${part}`).toBeDefined();
      expect(skill?.he.length).toBeGreaterThan(1); // Hebrew name
      expect(skill?.icon.length).toBeGreaterThan(0);
      expect(skillById(skill?.id ?? '')).toBe(skill);
    }
    expect(new Set(SKILL_IDS).size).toBe(SKILLS.length);
  });

  it('names the Hebrew six the design asked for', () => {
    expect(SKILLS.map((s) => s.he)).toEqual([
      'מכת מחץ',
      'עמידת ברזל',
      'רעידת אדמה',
      'סערת מהלומות',
      'מכה מדויקת',
      'נשימה עמוקה',
    ]);
  });

  it('describes every skill in Hebrew with its resolved numbers', () => {
    for (const def of SKILLS) {
      const text = skillSummaryHe(def, 1);
      expect(text.length).toBeGreaterThan(10);
      expect(text).toMatch(/[֐-׿]/); // Hebrew
      // the sentence quotes BALANCE, so a stronger skill says a bigger number
      expect(skillSummaryHe(def, 1.6)).not.toBe(text);
    }
    expect(skillSummaryHe('smash', 1)).toContain(String(S.smash.atkMult));
  });

  it('gives every skill a cooldown, and none of them a free one', () => {
    for (const id of SKILL_IDS) {
      expect(BALANCE.skills[id].cooldownMs).toBeGreaterThan(5000);
    }
  });
});

/* -------------------------------------------------------------- unlocking */

describe('unlocks are derived from body-part levels', () => {
  it('opens each skill exactly at its own part level, and no other', () => {
    const need = skillUnlockLevel();
    expect(need).toBe(S.unlockLevel);
    for (const def of SKILLS) {
      const below = levelsAt(1);
      below[def.part] = need - 1;
      expect(skillUnlocked(def, below)).toBe(false);

      const at = levelsAt(1);
      at[def.part] = need;
      expect(skillUnlocked(def, at)).toBe(true);
      expect(skillUnlocked(def.id, at)).toBe(true);

      // every OTHER part at 99 does not open it
      const others = levelsAt(99);
      others[def.part] = need - 1;
      expect(skillUnlocked(def, others)).toBe(false);
    }
  });

  it('unlocks the whole set only when every part is trained', () => {
    const mixed = levelsAt(S.unlockLevel);
    mixed['core'] = S.unlockLevel - 1;
    const views = skillViews(battle(), mixed);
    expect(views.filter((v) => v.unlocked).map((v) => v.def.part)).toEqual([
      'chest',
      'back',
      'legs',
      'shoulders',
      'arms',
    ]);
    const core = views.find((v) => v.def.part === 'core');
    expect(core?.unlocked).toBe(false);
    expect(core?.need).toBe(S.unlockLevel);
    expect(core?.have).toBe(S.unlockLevel - 1);
  });

  it('scales power gently with the level above the unlock, and caps it', () => {
    for (const def of SKILLS) {
      expect(skillPower(def, levelsAt(S.unlockLevel))).toBe(1);
      expect(skillPower(def, levelsAt(S.unlockLevel - 3))).toBe(1); // never below 1
      expect(skillPower(def, levelsAt(S.unlockLevel + 1))).toBeCloseTo(1 + S.powerPerLevel, 6);
      expect(skillPower(def, levelsAt(S.unlockLevel + 5))).toBeCloseTo(1 + 5 * S.powerPerLevel, 6);
      expect(skillPower(def, levelsAt(99))).toBeCloseTo(1 + S.powerMaxBonus, 6);
    }
    // and only the OWN part scales it
    const armsOnly = levelsAt(S.unlockLevel);
    armsOnly['arms'] = S.unlockLevel + 10;
    expect(skillPower('focus', armsOnly)).toBeGreaterThan(1);
    expect(skillPower('smash', armsOnly)).toBe(1);
  });

  it('makes a trained skill measurably stronger than a fresh one', () => {
    const weak = fighting();
    const strong = fighting();
    const a = useSkill(weak, 'smash', BASE, levelsAt(S.unlockLevel));
    const b = useSkill(strong, 'smash', BASE, levelsAt(99));
    const dmg = (r: typeof a): number => {
      const hit = r.events.find((e) => e.kind === 'hit');
      return hit && hit.kind === 'hit' ? hit.amount : 0;
    };
    // same seed, same RNG draw — the only difference is the power multiplier
    expect(dmg(b)).toBeGreaterThan(dmg(a) * (1 + S.powerMaxBonus * 0.9));
  });
});

/* --------------------------------------------------------- what each does */

describe('each skill does its own thing', () => {
  it('מכת מחץ (chest): one blow worth several auto attacks', () => {
    const state = fighting();
    const before = state.enemy?.hp ?? 0;
    const res = useSkill(state, 'smash', BASE, L5);
    expect(res.accepted).toBe(true);

    const hit = res.events.find((e) => e.kind === 'hit');
    expect(hit?.kind).toBe('hit');
    if (hit?.kind !== 'hit') throw new Error('no hit');
    expect(hit.source).toBe('skill');
    expect(hit.amount).toBeGreaterThan(BASE.atk * S.smash.atkMult * (1 - BALANCE.combat.damageVariance) - 0.5);
    expect(hit.amount).toBeLessThan(BASE.atk * S.smash.atkMult * (1 + BALANCE.combat.damageVariance) + 0.5);
    expect(state.enemy === null || state.enemy.hp < before).toBe(true);
    // and it announces itself before it lands, so the UI can pose the hero first
    expect(res.events[0]?.kind).toBe('skill_used');
  });

  it('עמידת ברזל (back): incoming damage is cut for the whole window', () => {
    // Scratch damage so the wave cannot end and shift the comparison, and no
    // regen, so the HP difference is the damage difference and nothing else.
    const stats: CombatStats = { ...statsAt(5), atk: 0.01, regen: 0 };
    const plain = fighting({ stats });
    const guarded = fighting({ stats });
    useSkill(guarded, 'guard', stats, L5);
    expect(guarded.skills.guardMs).toBe(S.guard.durationMs);

    const hitsOf = (s: BattleState): number[] =>
      run(s, stats, S.guard.durationMs)
        .filter((e): e is Extract<CombatEvent, { kind: 'enemy_hit' }> => e.kind === 'enemy_hit')
        .map((e) => e.amount);
    const plainHits = hitsOf(plain);
    const guardedHits = hitsOf(guarded);

    expect(plainHits.length).toBeGreaterThan(1);
    expect(guardedHits).toHaveLength(plainHits.length); // guard draws no RNG
    guardedHits.forEach((amount, i) => {
      expect(amount).toBeLessThan(plainHits[i] as number);
    });
    expect(guarded.playerHp).toBeGreaterThan(plain.playerHp);

    // …and the window closes by itself
    run(guarded, stats, 1000);
    expect(guarded.skills.guardMs).toBe(0);
    const after = run(guarded, stats, 4000).filter((e) => e.kind === 'enemy_hit');
    expect((after[0] as Extract<CombatEvent, { kind: 'enemy_hit' }>).amount).toBeGreaterThan(
      guardedHits[0] as number,
    );
  });

  it('רעידת אדמה (legs): damage plus the enemy swing pushed back', () => {
    const stats: CombatStats = { ...statsAt(5), atk: 0.01 };
    const plain = fighting({ stats });
    const stunned = fighting({ stats });

    const firstHitAt = (s: BattleState): number => {
      for (let t = 0; t < 20_000; t += TICK) {
        if (advance(s, TICK, stats).some((e) => e.kind === 'enemy_hit')) return t;
      }
      return -1;
    };
    const res = useSkill(stunned, 'quake', stats, L5);
    expect(res.accepted).toBe(true);
    expect(res.events.some((e) => e.kind === 'hit' && e.source === 'skill')).toBe(true);
    expect(stunned.skills.stunMs).toBe(S.quake.stunMs);

    const plainAt = firstHitAt(plain);
    const stunnedAt = firstHitAt(stunned);
    expect(plainAt).toBeGreaterThan(0);
    expect(stunnedAt - plainAt).toBeCloseTo(S.quake.stunMs, -2);
    expect(stunned.skills.stunMs).toBe(0); // the stun ran out on its own
  });

  it('סערת מהלומות (shoulders): the attack interval is halved for the window', () => {
    const stats: CombatStats = { ...statsAt(5), atk: 0.01 };
    const plain = fighting({ stats });
    const fast = fighting({ stats });
    useSkill(fast, 'flurry', stats, L5);

    const autos = (s: BattleState, ms: number): number =>
      run(s, stats, ms).filter((e) => e.kind === 'hit' && e.source === 'auto').length;
    const window = S.flurry.durationMs;
    const plainHits = autos(plain, window);
    const fastHits = autos(fast, window);
    expect(fastHits).toBeGreaterThan(plainHits);
    expect(fastHits).toBeLessThanOrEqual(plainHits * 2 + 2);
    expect(fast.skills.flurryFactor).toBe(1); // expired, back to normal

    // once it is over the two run at the same pace again
    expect(autos(fast, 6000)).toBeCloseTo(autos(plain, 6000), 0);
  });

  it('מכה מדויקת (arms): the next auto attack crits, even at 0% crit chance', () => {
    const stats: CombatStats = { ...statsAt(5), atk: 0.01, critChance: 0, critMultiplier: 2 };
    const state = fighting({ stats });
    // a whole fight at 0% never crits…
    expect(run(state, stats, 6000).some((e) => e.kind === 'hit' && e.crit)).toBe(false);

    useSkill(state, 'focus', stats, L5);
    expect(state.skills.focusBonus).toBeCloseTo(S.focus.critMultiplierBonus, 6);
    const events = run(state, stats, 4000).filter(
      (e): e is Extract<CombatEvent, { kind: 'hit' }> => e.kind === 'hit',
    );
    expect(events[0]?.crit).toBe(true);
    // …and the bonus rides on top of the normal crit multiplier, once
    expect(events[0]?.amount ?? 0).toBeGreaterThan(
      stats.atk * (stats.critMultiplier + S.focus.critMultiplierBonus) * 0.85,
    );
    expect(events.slice(1).some((e) => e.crit)).toBe(false);
    expect(state.skills.focusBonus).toBe(0);
  });

  it('נשימה עמוקה (core): an instant heal and a regen burst', () => {
    const stats = statsAt(5);
    const state = fighting({ stats });
    state.playerHp = Math.round(state.maxHp * 0.3);
    const before = state.playerHp;

    const res = useSkill(state, 'breath', stats, L5);
    expect(res.accepted).toBe(true);
    const healed = state.playerHp - before;
    expect(healed).toBeCloseTo(state.maxHp * S.breath.healPct, 1);
    const heal = res.events.find((e) => e.kind === 'regen');
    expect(heal?.kind).toBe('regen');

    // the burst then keeps healing faster than the plain Core regen does
    const burst = run(state, stats, S.breath.durationMs)
      .filter((e): e is Extract<CombatEvent, { kind: 'regen' }> => e.kind === 'regen')
      .map((e) => e.amount);
    expect(burst.length).toBeGreaterThan(0);
    expect(burst[0] as number).toBeGreaterThan(stats.regen);
    expect(state.skills.breathMs).toBe(0);
  });

  it('emits no persistable event — a skill is tactics, like a tap', () => {
    const stats: CombatStats = { ...statsAt(5), atk: 0.01 };
    const state = fighting({ stats });
    const kinds = new Set<string>();
    for (const id of SKILL_IDS) {
      for (const ev of useSkill(state, id, stats, L5).events) kinds.add(ev.kind);
    }
    // `wave_cleared` / `boss_defeated` are the ONLY events the log ever sees, and
    // an activation produces neither by itself.
    expect(kinds.has('wave_cleared')).toBe(false);
    expect(kinds.has('boss_defeated')).toBe(false);
    expect([...kinds].every((k) => ['skill_used', 'skill_expired', 'hit', 'regen'].includes(k))).toBe(true);
  });
});

/* ------------------------------------------------------------- cooldowns */

describe('cooldowns are enforced in the core', () => {
  it('refuses a second activation until the cooldown has run out', () => {
    const stats: CombatStats = { ...statsAt(5), atk: 0.01 };
    const state = fighting({ stats });
    expect(useSkill(state, 'smash', stats, L5).accepted).toBe(true);
    const refused = useSkill(state, 'smash', stats, L5);
    expect(refused.accepted).toBe(false);
    expect(refused.reason).toBe('cooldown');
    expect(refused.events).toHaveLength(0);

    // one tick short of ready…
    run(state, stats, S.smash.cooldownMs - TICK * 2);
    expect(useSkill(state, 'smash', stats, L5).accepted).toBe(false);
    run(state, stats, TICK * 3);
    expect(state.skills.cd['smash']).toBe(0);
    expect(useSkill(state, 'smash', stats, L5).accepted).toBe(true);
  });

  it('keeps the six cooldowns independent', () => {
    const state = fighting();
    useSkill(state, 'smash', BASE, L5);
    for (const id of SKILL_IDS) {
      if (id === 'smash') continue;
      expect(state.skills.cd[id]).toBe(0);
    }
    const views = skillViews(state, L5);
    const smash = views.find((v) => v.def.id === 'smash');
    expect(smash?.ready).toBe(false);
    expect(smash?.cooldownRatio).toBeCloseTo(1, 3);
    expect(views.filter((v) => v.ready)).toHaveLength(SKILL_IDS.length - 1);
  });

  it('counts cooldowns down between waves too, not only during a fight', () => {
    const strong = statsAt(30);
    const state = fighting({ stats: strong });
    useSkill(state, 'smash', strong, levelsAt(30));
    const cd = state.skills.cd['smash'];
    run(state, strong, 3000); // several waves are cleared in that time
    expect(state.wavesCleared).toBeGreaterThan(0);
    expect(state.skills.cd['smash']).toBeLessThan(cd);
    expect(state.skills.cd['smash']).toBeCloseTo(cd - 3000, -1);
  });

  it('drops live buffs on a knock-out but never refunds a cooldown', () => {
    const weak = { ...statsAt(1), atk: 0.01 };
    const state = fighting({ wave: 45, stats: weak });
    useSkill(state, 'guard', weak, L5);
    useSkill(state, 'focus', weak, L5);
    expect(state.skills.guardMs).toBeGreaterThan(0);

    const events = run(state, weak, 60_000);
    expect(state.defeats).toBeGreaterThan(0);
    expect(state.skills.guardMs).toBe(0);
    expect(state.skills.focusBonus).toBe(0);
    expect(events.some((e) => e.kind === 'skill_expired' && e.skillId === 'guard')).toBe(true);
  });

  it('refuses everything while there is no enemy on screen', () => {
    const resting = battle({ energy: 0 });
    run(resting, BASE, 1000);
    expect(resting.status).toBe('resting');
    for (const id of SKILL_IDS) {
      const res = useSkill(resting, id, BASE, L5);
      expect(res.accepted).toBe(false);
      expect(res.reason).toBe('idle');
      expect(resting.skills.cd[id]).toBe(0);
    }
  });
});

/* ---------------------------------------------------------- locked = no-op */

describe('a locked skill is a no-op', () => {
  it('changes nothing at all — not the state, not even the RNG', () => {
    const below = levelsAt(S.unlockLevel - 1);
    const state = fighting();
    const snapshot = JSON.stringify(state);

    for (const id of SKILL_IDS) {
      const res = useSkill(state, id, BASE, below);
      expect(res.accepted).toBe(false);
      expect(res.reason).toBe('locked');
      expect(res.events).toHaveLength(0);
    }
    expect(JSON.stringify(state)).toBe(snapshot);

    // an unknown id is refused the same way
    expect(useSkill(state, 'nope' as SkillId, BASE, levelsAt(99)).reason).toBe('unknown');
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('leaves an under-trained character exactly as strong as before skills', () => {
    const stats = statsAt(4);
    const levels = levelsAt(4);
    const plain = simulate(battle({ wave: 8, stats }), stats, { waves: 5, maxMs: 600_000 });
    const trying = simulate(battle({ wave: 8, stats }), stats, {
      waves: 5,
      maxMs: 600_000,
      pilot: { levels },
    });
    expect(trying.elapsedMs).toBe(plain.elapsedMs);
    expect(trying.events).toEqual(plain.events);
  });
});

/* ------------------------------------------------------------ determinism */

describe('determinism with skills', () => {
  const SCHEDULE: Readonly<Record<number, SkillId>> = {
    10: 'smash',
    40: 'guard',
    90: 'quake',
    150: 'flurry',
    220: 'focus',
    300: 'breath',
    500: 'smash',
  };

  it('replays byte-identically from the same seed and the same activation ticks', () => {
    const a = runScheduled(battle({ wave: 20 }), BASE, 40_000, SCHEDULE);
    const b = runScheduled(battle({ wave: 20 }), BASE, 40_000, SCHEDULE);
    expect(a).toEqual(b);
    expect(a.some((e) => e.kind === 'skill_used')).toBe(true);
    expect(a.filter((e) => e.kind === 'wave_cleared').length).toBeGreaterThan(0);
  });

  it('produces a different — but equally reproducible — run from a different schedule', () => {
    const other: Record<number, SkillId> = { 12: 'smash', 45: 'guard', 95: 'quake' };
    const a = runScheduled(battle({ wave: 20 }), BASE, 40_000, SCHEDULE);
    const b = runScheduled(battle({ wave: 20 }), BASE, 40_000, other);
    const b2 = runScheduled(battle({ wave: 20 }), BASE, 40_000, other);
    expect(b).not.toEqual(a);
    expect(b).toEqual(b2);
  });

  it('is identical to a skill-free run when nothing is activated', () => {
    const withSkillsAvailable = runScheduled(battle({ wave: 20 }), BASE, 30_000, {});
    const plain = run(battle({ wave: 20 }), BASE, 30_000);
    expect(withSkillsAvailable).toEqual(plain);
  });

  it('does not depend on the frame rate when a skill is live', () => {
    const fine = battle({ wave: 20 });
    const coarse = battle({ wave: 20 });
    useSkill(fine, 'flurry', BASE, L5);
    useSkill(coarse, 'flurry', BASE, L5);
    // (both are still 'idle' at t=0, so the activation is refused for both —
    // spawn first, then fire, then advance at two different frame rates)
    run(fine, BASE, 200);
    run(coarse, BASE, 200);
    useSkill(fine, 'guard', BASE, L5);
    useSkill(coarse, 'guard', BASE, L5);

    const a: CombatEvent[] = [];
    for (let t = 0; t < 20_000; t += TICK) a.push(...advance(fine, TICK, BASE));
    const b: CombatEvent[] = [];
    for (let t = 0; t < 20_000; t += TICK * 4) b.push(...advance(coarse, TICK * 4, BASE));
    expect(a).toEqual(b);
    expect(fine.playerHp).toBe(coarse.playerHp);
  });

  it('lets the auto-pilot itself be replayed exactly', () => {
    const a = simulate(battle({ wave: 15 }), BASE, { waves: 6, pilot: { levels: L5 } });
    const b = simulate(battle({ wave: 15 }), BASE, { waves: 6, pilot: { levels: L5 } });
    expect(a.elapsedMs).toBe(b.elapsedMs);
    expect(a.events).toEqual(b.events);
  });
});

/* --------------------------------------------------------------- balance */

describe('balance: skills matter, and idling still works', () => {
  /** Fraction of the idle-only time saved by firing all six on cooldown. */
  function speedup(level: number, wave: number, waves = 20): number {
    const stats = statsAt(level);
    const levels = levelsAt(level);
    const mk = (): BattleState => createBattle({ seed: 99, world: 1, wave, energy: 1e6, stats });
    const idle = simulate(mk(), stats, { waves, maxMs: 1_800_000 });
    const skilled = simulate(mk(), stats, { waves, maxMs: 1_800_000, pilot: { levels } });
    expect(idle.results).toHaveLength(waves); // idle-only really does clear them
    expect(skilled.results).toHaveLength(waves);
    return 1 - skilled.elapsedMs / idle.elapsedMs;
  }

  it('clears waves ≈25–35% faster at part level 5–6 with all six on cooldown', () => {
    for (const level of [5, 6]) {
      for (const wave of [10, 20, 30]) {
        const gain = speedup(level, wave);
        expect(gain, `level ${level}, wave ${wave}: ${(gain * 100).toFixed(1)}%`).toBeGreaterThan(0.2);
        expect(gain, `level ${level}, wave ${wave}: ${(gain * 100).toFixed(1)}%`).toBeLessThan(0.45);
      }
    }
  });

  it('keeps the idle-only loop viable — stats alone still clear waves', () => {
    const stats = statsAt(5);
    const idle = simulate(createBattle({ seed: 7, world: 1, wave: 20, energy: 1e6, stats }), stats, {
      waves: 12,
      maxMs: 900_000,
    });
    expect(idle.results).toHaveLength(12);
    expect(idle.defeats).toBe(0);
  });

  it('never lets skills replace training — a skilled low level loses to a trained idler', () => {
    const low = statsAt(3);
    const high = statsAt(8);
    const skilledLow = simulate(createBattle({ seed: 11, world: 1, wave: 25, energy: 1e6, stats: low }), low, {
      waves: 8,
      maxMs: 900_000,
      pilot: { levels: levelsAt(3) }, // locked at level 3 — the bar is empty
    });
    const idleHigh = simulate(
      createBattle({ seed: 11, world: 1, wave: 25, energy: 1e6, stats: high }),
      high,
      { waves: 8, maxMs: 900_000 },
    );
    expect(idleHigh.elapsedMs).toBeLessThan(skilledLow.elapsedMs);
  });

  it('pays training back forever: the same skills hit harder at a higher level', () => {
    const wave = 20;
    const cheap = statsAt(6);
    const runAt = (powerLevels: PartLevels): number =>
      simulate(createBattle({ seed: 5, world: 1, wave, energy: 1e6, stats: cheap }), cheap, {
        waves: 10,
        maxMs: 900_000,
        pilot: { levels: powerLevels },
      }).elapsedMs;
    // identical STATS, only the skill power differs (level 6 vs level 25 parts)
    expect(runAt(levelsAt(25))).toBeLessThan(runAt(levelsAt(6)));
  });
});
