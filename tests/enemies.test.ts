/**
 * @vitest-environment jsdom
 *
 * The expanded enemy roster: 5–6 regulars plus the world's mini-boss, per world.
 *
 * Three things have to stay true when the roster grows, and each is one describe
 * block below:
 *   1. ARTWORK — every sprite is well-formed, self-contained, offline SVG drawn
 *      inside the shared 120×120 box, so an enemy cannot silently render as a
 *      blank square or leak a network request into the single-file build;
 *   2. BALANCE — a flavour multiplier is a wobble on the wave curve, never a
 *      replacement for it. `BALANCE.combat.enemy` stays authoritative, and a
 *      mid-level character keeps progressing at the tuned rate;
 *   3. DETERMINISM & REPLAY — the wave→enemy pick is a pure function of the wave
 *      number, and a log written before the roster grew replays to the identical
 *      state, because the enemy is data in the payload and never re-derived.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  createBattle,
  simulate,
  waveSpec,
  waveStretch,
  worldAtkFactor,
  worldCoinFactor,
  worldHpFactor,
  type CombatStats,
} from '../src/core/combat.ts';
import { deriveStats, emptyGame } from '../src/core/xp.ts';
import {
  DEFAULT_CURVE_SPAN,
  ENEMIES,
  WORLDS,
  curveSpanOf,
  WORLD_BOSSES,
  enemyById,
  enemyForWave,
  miniBossOf,
  regularEnemies,
} from '../src/data/gameContent.ts';
import { BODY_PARTS } from '../src/data/program.ts';
import { rebuildFromEvents } from '../src/storage/migrate.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';

/** Stats of a character whose six parts are all at `level` (mirrors combat.test). */
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

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/* ----------------------------------------------------------------- roster */

describe('enemy roster', () => {
  it('gives every world 5–6 regulars plus exactly one mini-boss', () => {
    for (const w of WORLDS) {
      const regulars = regularEnemies(w.id);
      expect(regulars.length, `world ${w.id}`).toBeGreaterThanOrEqual(5);
      expect(regulars.length, `world ${w.id}`).toBeLessThanOrEqual(6);
      expect(regulars.every((e) => e.kind === 'regular')).toBe(true);
      expect(regulars.every((e) => e.world === w.id)).toBe(true);
      expect(miniBossOf(w.id).kind).toBe('mini');
      expect(miniBossOf(w.id).world).toBe(w.id);
    }
  });

  it('has unique ids across the whole roster, and finds each one back', () => {
    const ids = [...ENEMIES, ...WORLD_BOSSES].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(enemyById(id)?.id).toBe(id);
    expect(enemyById('no_such_enemy')).toBeUndefined();
  });

  it('names every enemy in Hebrew and in English', () => {
    for (const e of ENEMIES) {
      expect(e.he.length, e.id).toBeGreaterThan(1);
      expect(e.he, e.id).toMatch(/[֐-׿]/); // real Hebrew, not a placeholder
      expect(e.en.length, e.id).toBeGreaterThan(1);
    }
  });
});

/* ---------------------------------------------------------------- artwork */

describe('enemy artwork', () => {
  it('draws every sprite as well-formed, self-contained SVG in the shared box', () => {
    const parser = new DOMParser();
    for (const def of ENEMIES) {
      const doc = parser.parseFromString(def.svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror'), `${def.id} sprite is not valid XML`).toBeNull();
      expect(doc.documentElement.tagName).toBe('svg');
      expect(doc.documentElement.getAttribute('viewBox'), def.id).toBe('0 0 120 120');
      expect(def.svg, `${def.id} reaches out to the network`).not.toMatch(
        /https?:\/\/(?!www\.w3\.org)/,
      );
      expect(def.svg, `${def.id} has a NaN coordinate`).not.toContain('NaN');
      // Bold enough to read at the arena's ~110px: several shapes, and a face.
      expect(doc.querySelectorAll('path,rect,circle,ellipse').length, def.id).toBeGreaterThanOrEqual(4);
      expect(doc.querySelectorAll('circle').length, `${def.id} has no eyes`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps every sprite inside its own viewBox', () => {
    const parser = new DOMParser();
    for (const def of ENEMIES) {
      const doc = parser.parseFromString(def.svg, 'image/svg+xml');
      for (const el of Array.from(doc.querySelectorAll('*'))) {
        for (const attr of ['x', 'y', 'cx', 'cy'] as const) {
          const raw = el.getAttribute(attr);
          if (raw === null) continue;
          const v = Number(raw);
          expect(Number.isFinite(v), `${def.id} ${attr}=${raw}`).toBe(true);
          // A little slack: a horn or a tail may poke past the edge on purpose.
          expect(v, `${def.id} ${attr} is off-canvas`).toBeGreaterThanOrEqual(-20);
          expect(v, `${def.id} ${attr} is off-canvas`).toBeLessThanOrEqual(140);
        }
      }
    }
  });
});

/* ---------------------------------------------------------------- balance */

describe('flavour multipliers', () => {
  it('keeps every multiplier inside sane bounds', () => {
    for (const e of ENEMIES) {
      expect(e.hpMult ?? 1, `${e.id} hpMult`).toBeGreaterThanOrEqual(0.7);
      expect(e.hpMult ?? 1, `${e.id} hpMult`).toBeLessThanOrEqual(1.5);
      expect(e.atkMult ?? 1, `${e.id} atkMult`).toBeGreaterThanOrEqual(0.7);
      expect(e.atkMult ?? 1, `${e.id} atkMult`).toBeLessThanOrEqual(1.5);
      // No enemy is strictly better than the curve on BOTH axes at once.
      expect((e.hpMult ?? 1) * (e.atkMult ?? 1), `${e.id} is a double threat`).toBeLessThanOrEqual(1.45);
    }
  });

  it('averages out to the tuned curve over one lap of a world roster', () => {
    for (const w of WORLDS) {
      const roster = regularEnemies(w.id);
      expect(mean(roster.map((e) => e.hpMult ?? 1)), `world ${w.id} hp`).toBeGreaterThan(0.92);
      expect(mean(roster.map((e) => e.hpMult ?? 1)), `world ${w.id} hp`).toBeLessThan(1.08);
      expect(mean(roster.map((e) => e.atkMult ?? 1)), `world ${w.id} atk`).toBeGreaterThan(0.92);
      expect(mean(roster.map((e) => e.atkMult ?? 1)), `world ${w.id} atk`).toBeLessThan(1.08);
    }
  });

  it('gives every world a nimble one, a tank and something in between', () => {
    for (const w of WORLDS) {
      const roster = regularEnemies(w.id);
      const nimble = roster.filter((e) => (e.hpMult ?? 1) < 0.9 && (e.atkMult ?? 1) > 1.05);
      const tank = roster.filter((e) => (e.hpMult ?? 1) > 1.15 && (e.atkMult ?? 1) < 0.95);
      const mid = roster.filter((e) => (e.hpMult ?? 1) >= 0.9 && (e.hpMult ?? 1) <= 1.15);
      expect(nimble.length, `world ${w.id} has no nimble enemy`).toBeGreaterThan(0);
      expect(tank.length, `world ${w.id} has no tank`).toBeGreaterThan(0);
      expect(mid.length, `world ${w.id} has no middle ground`).toBeGreaterThan(0);
    }
  });

  it('leaves the balance.ts wave curve authoritative over a whole world', () => {
    const e = BALANCE.combat.enemy;
    for (const w of WORLDS) {
      let actual = 0;
      let pure = 0;
      for (let wave = 1; wave <= w.waves; wave += 1) {
        const spec = waveSpec(w.id, wave);
        actual += spec.hp;
        pure +=
          e.hpBase *
          // the STRETCHED exponent: a world of n waves walks the same 50-wave
          // curve in n steps (see `waveStretch`), which is exactly what keeps a
          // longer world longer instead of harder.
          Math.pow(e.hpGrowth, (wave - 1) * waveStretch(w.id)) *
          worldHpFactor(w.id) *
          (spec.miniBoss ? e.miniBossHpMult : 1);
      }
      // The roster may wobble a world's total HP, never move it.
      expect(actual / pure, `world ${w.id} total HP drift`).toBeGreaterThan(0.95);
      expect(actual / pure, `world ${w.id} total HP drift`).toBeLessThan(1.05);
    }
  });

  /**
   * THE PROMISE OF THE STRETCH, stated as an equation rather than a feeling:
   * every world's LAST wave stands exactly `hpGrowth^span` above its first —
   * `span` classic waves of the base curve (49 for world 1, its own number for
   * a steeper world), however many waves the world is drawn over. Growing a
   * world's wave count therefore never moves its end; only `span` does, on
   * purpose (PHASE 11). The purse is the half that did NOT move: coins ride the
   * classic 49-step ramp whatever the span, so a world's last wave pays exactly
   * what wave 50 used to pay.
   */
  it('lands every world’s FINAL wave on exactly its span, and its purse on the old wave-50', () => {
    const e = BALANCE.combat.enemy;
    for (const w of WORLDS) {
      const span = curveSpanOf(w.id);
      expect(span).toBe(w.span ?? DEFAULT_CURVE_SPAN);
      const hpEnd = e.hpBase * Math.pow(e.hpGrowth, span) * worldHpFactor(w.id);
      const atkEnd = e.atkBase * Math.pow(e.atkGrowth, span) * worldAtkFactor(w.id);

      const last = waveSpec(w.id, w.waves);
      const hp = last.hp / ((last.enemy.hpMult ?? 1) * (last.miniBoss ? e.miniBossHpMult : 1));
      const atk = last.atk / ((last.enemy.atkMult ?? 1) * (last.miniBoss ? e.miniBossAtkMult : 1));

      expect(hp / hpEnd, `world ${w.id} final HP`).toBeCloseTo(1, 2);
      expect(atk / atkEnd, `world ${w.id} final ATK`).toBeCloseTo(1, 2);
      // …and the purse: the last wave pays what wave 50 used to pay, whatever
      // the world's span is.
      const legacyStep = BALANCE.combat.wavesFirstWorld - 1;
      const coins50 = Math.round(
        (BALANCE.combat.coins.base + BALANCE.combat.coins.perWave * legacyStep) *
          worldCoinFactor(w.id),
      );
      const coins = last.coins / (last.miniBoss ? BALANCE.combat.coins.miniBossMult : 1);
      expect(coins / coins50, `world ${w.id} final coins`).toBeCloseTo(1, 1);
    }
  });

  it('draws every world past the first on a steeper ramp than the one before it, never a shallower one', () => {
    // The spans are the retune's difficulty knob: worlds 2–4 climb, the taper
    // worlds hold a steep ramp. World 1 keeps the classic 49 exactly.
    expect(curveSpanOf(1)).toBe(DEFAULT_CURVE_SPAN);
    for (const w of WORLDS) {
      expect(curveSpanOf(w.id)).toBeGreaterThanOrEqual(DEFAULT_CURVE_SPAN);
      expect(curveSpanOf(w.id)).toBeLessThanOrEqual(70);
    }
  });

  it('leaves worlds 1–4 on the exact multipliers they shipped with', () => {
    // The taper starts at `lateWorldFrom`; everything before it is the shipped
    // 1.6× / 1.25× / 1.6× ladder, to the last decimal. This is the assertion
    // that says "the existing campaign did not move".
    const e = BALANCE.combat.enemy;
    for (let world = 1; world <= 4; world += 1) {
      expect(worldHpFactor(world), `world ${world} hp`).toBeCloseTo(Math.pow(e.worldHpMult, world - 1), 6);
      expect(worldAtkFactor(world), `world ${world} atk`).toBeCloseTo(Math.pow(e.worldAtkMult, world - 1), 6);
      expect(worldCoinFactor(world), `world ${world} coins`).toBeCloseTo(
        Math.pow(BALANCE.combat.coins.worldMult, world - 1),
        6,
      );
    }
    // …and from `lateWorldFrom` on the step is the gentler one, exactly, or the
    // late game would outrun a player whose gate levels are deliberately
    // compressed. World 5 is the FIRST tapered world.
    expect(e.lateWorldFrom).toBe(5);
    for (let world = e.lateWorldFrom; world <= WORLDS.length; world += 1) {
      expect(worldHpFactor(world) / worldHpFactor(world - 1), `world ${world}`).toBeCloseTo(
        e.lateWorldHpMult,
        6,
      );
      expect(worldAtkFactor(world) / worldAtkFactor(world - 1), `world ${world}`).toBeCloseTo(
        e.lateWorldAtkMult,
        6,
      );
    }
  });

  it('keeps world 1 arithmetically untouched — the stretch is exactly 1 there', () => {
    expect(waveStretch(1)).toBe(1);
    for (const wave of [1, 7, 13, 20, 33, 49, 50]) {
      const e = BALANCE.combat.enemy;
      const spec = waveSpec(1, wave);
      const pure =
        e.hpBase *
        Math.pow(e.hpGrowth, wave - 1) *
        (spec.miniBoss ? e.miniBossHpMult : 1) *
        (spec.enemy.hpMult ?? 1);
      expect(spec.hp).toBe(Math.max(1, Math.round(pure)));
    }
  });

  it('still lets a mid-level character grind a world at the tuned rate', () => {
    // Level 6 is roughly a 3×/week trainee ~13 workouts in — comfortably past
    // world 1's gate (level 3), so the whole world should fall without a loss.
    const stats = statsAt(6);
    const state = createBattle({ seed: 9182, world: 1, wave: 1, energy: 100_000, stats });
    const summary = simulate(state, stats, { waves: 24, maxMs: 900_000 });
    expect(summary.results).toHaveLength(24);
    expect(summary.results.map((r) => r.wave)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1),
    );
    expect(summary.defeats).toBe(0);
    // ≈15 s per wave was the shipped feel; the flavours may not double it.
    const perWave = summary.elapsedMs / summary.results.length;
    expect(perWave).toBeLessThan(20_000);
  });
});

/* ----------------------------------------------------------- determinism */

describe('wave → enemy selection', () => {
  it('is a pure function of the wave number', () => {
    for (const w of WORLDS) {
      for (let wave = 1; wave <= 60; wave += 1) {
        const mini = wave % BALANCE.combat.miniBossEvery === 0;
        const a = enemyForWave(w.id, wave, mini);
        const b = enemyForWave(w.id, wave, mini);
        expect(a).toBe(b);
        expect(a.world).toBe(w.id);
        expect(a.kind).toBe(mini ? 'mini' : 'regular');
      }
    }
  });

  it('cycles through the roster in order, and repeats after one lap', () => {
    for (const w of WORLDS) {
      const roster = regularEnemies(w.id);
      for (let wave = 1; wave <= roster.length; wave += 1) {
        expect(enemyForWave(w.id, wave, false).id).toBe(roster[wave - 1]?.id);
        expect(enemyForWave(w.id, wave + roster.length, false).id).toBe(roster[wave - 1]?.id);
      }
    }
  });

  it('keeps the first three waves of every world on the enemies they always had', () => {
    // The roster GREW rather than being reshuffled: the original three stay at
    // the front, so an install mid-way through world 1 does not find a stranger
    // where its wave-2 enemy used to be.
    expect(enemyForWave(1, 1, false).id).toBe('w1_dumbbell');
    expect(enemyForWave(1, 2, false).id).toBe('w1_rat');
    expect(enemyForWave(1, 3, false).id).toBe('w1_towel');
    expect(enemyForWave(2, 1, false).id).toBe('w2_dog');
    expect(enemyForWave(3, 1, false).id).toBe('w3_rookie');
    expect(enemyForWave(4, 1, false).id).toBe('w4_harpy');
  });

  it('sends every wave that is a multiple of 10 to the mini-boss', () => {
    for (const w of WORLDS) {
      for (const wave of [10, 20, 30, 40, 50]) {
        expect(waveSpec(w.id, wave).enemy.id).toBe(miniBossOf(w.id).id);
      }
    }
  });
});

/* --------------------------------------------------------- replay safety */

describe('old logs replay identically after the roster grew', () => {
  /**
   * A `wave_cleared` exactly as a build with three regulars per world wrote it.
   * `w1_dumbbell` at wave 4 is the point: back then wave 4 wrapped around to the
   * first enemy, today it meets the fourth — and the replay must not care.
   */
  function cleared(ts: number, wave: number, enemyId: string, coins: number): AppEvent {
    return {
      id: `ev${ts}`,
      ts,
      type: 'wave_cleared',
      payload: {
        date: '2025-05-04',
        world: 1,
        wave,
        miniBoss: wave % 10 === 0,
        enemyId,
        coins,
        energySpent: BALANCE.combat.energyPerWave,
        seed: 123456,
        durationMs: 8000,
      },
    };
  }

  const OLD_LOG: readonly AppEvent[] = [
    { id: 'e0', ts: 1000, type: 'energy_gained', payload: { amount: 500, date: '2025-05-04' } },
    cleared(2000, 1, 'w1_dumbbell', 5),
    cleared(3000, 2, 'w1_rat', 6),
    cleared(4000, 3, 'w1_towel', 7),
    cleared(5000, 4, 'w1_dumbbell', 8),
    cleared(6000, 5, 'w1_rat', 9),
    cleared(7000, 6, 'w1_towel', 10),
  ];

  it('folds the payload, never the current roster', () => {
    const battle = rebuildFromEvents(OLD_LOG, Date.parse('2025-06-01T00:00:00Z')).game?.battle;
    expect(battle).toBeDefined();
    expect(battle?.world).toBe(1);
    // six clears from wave 1 → parked on wave 7, whoever stands there today
    expect(battle?.wave).toBe(7);
    expect(battle?.wavesCleared).toBe(6);
    expect(battle?.miniBossesCleared).toBe(0);
    expect(battle?.coins).toBe(45);
    expect(battle?.bossesDefeated).toEqual([]);
  });

  it('spends exactly the energy the payloads recorded', () => {
    const game = rebuildFromEvents(OLD_LOG, Date.parse('2025-06-01T00:00:00Z')).game;
    expect(game?.energy).toBe(500 - 6 * BALANCE.combat.energyPerWave);
  });

  it('is stable under repeated replay', () => {
    const now = Date.parse('2025-06-01T00:00:00Z');
    expect(rebuildFromEvents(OLD_LOG, now).game).toEqual(rebuildFromEvents([...OLD_LOG], now).game);
  });

  it('keeps a recorded enemy id resolvable even though the wave moved on', () => {
    // The log is the history; `enemyById` is how the adventure feed reads it.
    expect(enemyById('w1_dumbbell')?.he).toBe('משקולת חלודה');
    expect(enemyForWave(1, 4, false).id).not.toBe('w1_dumbbell'); // the roster grew
  });
});
