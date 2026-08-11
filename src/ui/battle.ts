/**
 * ui/battle.ts — screen 3, "קרב".
 *
 * The arena: the character SVG (reused at a smaller scale) against the wave's
 * enemy sprite, HP bars for both, floating damage numbers, the energy bar, the
 * wave counter and the super-move meter.
 *
 * This module owns NO game rules — `core/combat.ts` simulates and this file
 * renders. It also owns the honesty guarantees the brief asks for:
 *   - the loop runs ONLY while this tab is visible and mounted (`stopBattle()`
 *     on tab switch, `visibilitychange` while mounted) — no offline earnings;
 *   - the simulation is fed real elapsed time, capped inside `advance()`, so a
 *     backgrounded tab cannot bank progress;
 *   - one `wave_cleared` event per cleared wave goes to the DataStore, nothing
 *     per attack.
 *
 * Motion: damage numbers and the screen shake are CSS animations, and the global
 * `prefers-reduced-motion` rule disables them; the shake class is additionally
 * skipped when the media query matches, so nothing moves at all.
 *
 * THE FIGHT'S ANIMATIONS (`styles/anim.css`) hang off the SAME render path. The
 * loop already receives every `hit` / `enemy_hit` / `wave_cleared` /
 * `boss_defeated` the simulation produces, so `consume()` toggles a short-lived
 * class on the hero or the enemy sprite and the CSS does the rest. No new event,
 * no second clock, no change to `core/combat.ts`: an attack lunge fires per
 * attack event, which means it automatically follows a Shoulders-driven attack
 * interval as the player trains. Durations come from `ANIM` below, which derives
 * them from `BALANCE` and publishes them to CSS as custom properties.
 */

import { BALANCE } from '../core/balance.ts';
import {
  advance,
  bossSpec,
  bossStanding,
  createBattle,
  isEndgame,
  setEnergy,
  setGate,
  superReady,
  tap,
  useSuper,
  waveSpec,
  worldGate,
  type CombatEvent,
  type CombatStats,
} from '../core/combat.ts';
import { gameOf, onBossDefeated, onWaveCleared } from '../core/game.ts';
import { statsOfGame } from '../core/xp.ts';
import { BODY_PART_HE, BODY_PARTS, type BodyPart } from '../data/program.ts';
import { WORLDS, WORLD_COUNT, worldById, worldBossOf } from '../data/gameContent.ts';
import type { DataStore, GameState } from '../storage/DataStore.ts';
import { characterSvg } from './characterSvg.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { fmtXp } from './xpfx.ts';

export interface BattleDeps {
  store: DataStore;
  /** Re-render the shell (the header energy pill follows the battle). */
  refreshHeader: () => void;
  /**
   * Rebuild the whole arena. Called after a world boss falls, because the world,
   * the enemy roster and the gate card all change at once.
   */
  remount?: () => void;
}

interface Runtime {
  stop: () => void;
}

/** Only one battle can be live at a time; the app stops it on every tab switch. */
let active: Runtime | null = null;

export function stopBattle(): void {
  active?.stop();
  active = null;
}

function statsOf(game: GameState): CombatStats {
  const s = statsOfGame(game);
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

function partLevels(game: GameState): Record<BodyPart, number> {
  const out = {} as Record<BodyPart, number>;
  for (const p of BODY_PARTS) out[p] = game.parts[p].level;
  return out;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- animation */

/**
 * Durations of the arena's CSS animations, in ms.
 *
 * They are DERIVED from the tuning constants rather than typed twice, because
 * two of them have to agree with the simulation or the screen lies:
 *   - `die` must finish inside `spawnDelayMs`, or a corpse is still collapsing
 *     while its successor spawns;
 *   - `attack` must finish inside the fastest possible attack interval
 *     (`attackIntervalMinMs`), or a fast character's lunges pile up and the hero
 *     never returns to its resting pose.
 * They are pushed to CSS as custom properties on the arena, so `styles/anim.css`
 * reads the same numbers this file computed.
 */
const ANIM = {
  attack: Math.min(240, BALANCE.stats.attackIntervalMinMs - 60),
  hit: 220,
  die: Math.min(360, BALANCE.combat.spawnDelayMs - 40),
  /** The super already shakes the screen — the pose runs for the same beat. */
  super: 480,
  /** Must be over before `queueRemount` tears the arena down (900 ms). */
  victory: 800,
} as const;

/**
 * A per-sprite idle rhythm: enemies that bob in lockstep read as one object, so
 * each sprite gets its own period. Derived from the enemy id (a tiny FNV hash),
 * NOT from a random draw — the arena stays as reproducible as the fight in it.
 */
function bobDuration(enemyId: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < enemyId.length; i += 1) {
    h = Math.imul(h ^ enemyId.charCodeAt(i), 16777619) >>> 0;
  }
  return 2200 + (h % 9) * 130;
}

/* ------------------------------------------------------------------ view */

export function renderBattle(main: HTMLElement, deps: BattleDeps): void {
  stopBattle();
  const { store } = deps;
  const game = gameOf(store);
  const stats = statsOf(game);
  const world = worldById(game.battle.world);
  const atBoss = bossStanding(game.battle.world, game.battle.wave, game.battle.bossesDefeated);
  const spec = atBoss ? null : waveSpec(game.battle.world, game.battle.wave);
  const champion = isEndgame(game.battle.bossesDefeated);

  main.innerHTML = `
  <section class="bt-card">
    <div class="bt-worldbar">
      <div class="bt-world">
        <b>${esc(world.he)}${champion ? ' 👑' : ''}</b>
        <span>עולם ${world.id}/${WORLD_COUNT} · ${esc(champion ? 'מצב אלוף — הגלים ממשיכים בלי סוף' : world.tagline)}</span>
      </div>
      <div class="bt-wave"><b id="btWave">${game.battle.wave}</b><span>גל</span></div>
    </div>

    ${worldStrip(game)}

    <div class="bt-arena" id="btArena" style="--w-accent:${world.accent};--w-bg1:${world.bg[0]};--w-bg2:${world.bg[1]}">
      <div class="bt-fx" id="btFx" aria-hidden="true"></div>

      <div class="bt-side bt-hero">
        <div class="bt-sprite hero" id="btHeroSprite">${characterSvg(game.parts, {
          label: 'הדמות שלך בקרב',
          // The arena fights with whoever the דמות screen selected.
          character: game.characters.selected,
        })}</div>
        <div class="bt-bar hp"><span id="btHeroHp" style="width:100%"></span></div>
        <div class="bt-hp-txt" id="btHeroHpTxt">${Math.round(stats.maxHp)} / ${Math.round(stats.maxHp)}</div>
      </div>

      <div class="bt-vs" id="btVs">VS</div>

      <button class="bt-side bt-enemy" id="btEnemy" type="button" aria-label="תקוף את האויב">
        <div class="bt-sprite enemy" id="btEnemySprite">${spec ? spec.enemy.svg : ''}</div>
        <div class="bt-bar foe"><span id="btFoeHp" style="width:100%"></span></div>
        <div class="bt-hp-txt" id="btFoeHpTxt"></div>
        <div class="bt-foe-name" id="btFoeName">${spec ? esc(spec.enemy.he) : ''}</div>
      </button>
    </div>

    <p class="bt-status" id="btStatus"></p>

    <div class="bt-meters">
      <div class="bt-meter">
        <div class="bm-head"><span>⚡ אנרגיה</span><b id="btEnergy">${fmtXp(game.energy)}</b></div>
        <div class="bt-bar energy"><span id="btEnergyBar" style="width:0%"></span></div>
        <div class="bm-foot">${BALANCE.combat.energyPerWave} ⚡ לכל גל · אנרגיה נצברת רק מאימון אמיתי</div>
      </div>
      <div class="bt-meter">
        <div class="bm-head"><span>💥 מהלך על</span><b id="btSuperPct">0%</b></div>
        <div class="bt-bar super"><span id="btSuperBar" style="width:0%"></span></div>
        <div class="bm-foot">כל הקשה על האויב טוענת את המד</div>
      </div>
    </div>

    <button class="bt-super-btn" id="btSuper" disabled>💥 שחרר מהלך על</button>

    <div class="bt-stats">
      <div class="cm-item"><b>🪙 <span id="btCoins">${fmtXp(game.battle.coins)}</span></b><span>מטבעות</span></div>
      <div class="cm-item"><b id="btCleared">${game.battle.wavesCleared}</b><span>גלים שנוצחו</span></div>
      <div class="cm-item"><b id="btMinis">${game.battle.miniBossesCleared}</b><span>מיני־בוסים</span></div>
      <div class="cm-item"><b id="btBosses">${game.battle.bossesDefeated.length}</b><span>בוסי עולם</span></div>
    </div>
    <p class="gc-note">המטבעות נקנים לציוד בלשונית 🦸 דמות — הציוד מתווסף לסטטיסטיקות ונראה על הדמות.</p>
  </section>

  <section class="game-card">
    <h3 class="gc-title">כוח לחימה <span class="gc-sub">נגזר מרמות הגוף</span></h3>
    <div class="stat-grid">
      <div class="stat"><span class="s-k">התקפה</span><b>${stats.atk}</b></div>
      <div class="stat"><span class="s-k">הגנה</span><b>${stats.def}</b></div>
      <div class="stat"><span class="s-k">חיים</span><b>${stats.maxHp}</b></div>
      <div class="stat"><span class="s-k">מהירות</span><b>${(stats.attackIntervalMs / 1000).toFixed(2)}s</b></div>
      <div class="stat"><span class="s-k">קריטי</span><b>${Math.round(stats.critChance * 100)}%</b></div>
      <div class="stat"><span class="s-k">התאוששות</span><b>${stats.regen}/ש׳</b></div>
    </div>
    <p class="gc-note">הקרב רץ רק כשלשונית הקרב פתוחה — אין רווחים אופליין.</p>
  </section>

  ${gateCard(game)}`;

  wireWorldStrip(main, store);
  start(main, deps);
}

/* ------------------------------------------------------ world progress strip */

/**
 * The four worlds as one compact row of nodes, directly under the world bar.
 *
 * It answers the three questions the arena could not answer before without
 * scrolling: where am I in the run, how far into THIS world am I, and is the
 * boss at the end of it open yet. Each node carries the world's icon, its Hebrew
 * name and one status glyph:
 *
 *   🏆 the world's boss is a trophy      ✓ the gate is met — the boss is ready
 *   🔒 locked (a future world, or a gate that still wants training)
 *   👑 champion mode — the last boss is down and world 4 runs forever
 *
 * The current node also carries `גל 23/50` and a hairline progress bar. Tapping
 * any node explains it in Hebrew; tapping the CURRENT one scrolls to the gate
 * card that already renders the full met/unmet list, rather than duplicating it.
 */
function worldStrip(game: GameState): string {
  const cur = game.battle.world;
  const wave = game.battle.wave;
  const perWorld = BALANCE.combat.wavesPerWorld;
  const champion = isEndgame(game.battle.bossesDefeated);
  const gate = worldGate(cur, partLevels(game));

  const nodes = WORLDS.map((w) => {
    const boss = worldBossOf(w.id);
    const cleared = boss !== undefined && game.battle.bossesDefeated.includes(boss.id);
    const current = w.id === cur;
    const locked = !cleared && !current;
    const championHere = current && champion;

    const glyph = championHere ? '👑' : cleared ? '🏆' : locked ? '🔒' : gate.locked ? '🔒' : '✓';
    const state = championHere
      ? 'champion'
      : current
        ? gate.locked
          ? 'current gated'
          : 'current ready'
        : cleared
          ? 'done'
          : 'locked';

    let meta: string;
    if (championHere) meta = `גל ${wave}`;
    else if (current) meta = wave > perWorld ? 'קרב בוס' : `גל ${wave}/${perWorld}`;
    else if (cleared) meta = 'הושלם';
    else meta = 'נעול';

    const pct = current && !champion ? Math.min(100, Math.round(((wave - 1) / perWorld) * 100)) : 0;
    const label = `${w.he} · ${meta}${current ? (gate.locked ? ' · הבוס נעול' : ' · הבוס פתוח') : ''}`;

    return `<li class="wp-node ${state}">
      <button class="wp-btn" type="button" data-world="${w.id}" aria-label="${esc(label)}"
        ${current ? 'aria-current="step"' : ''}>
        <span class="wp-glyph" aria-hidden="true">${glyph}</span>
        <span class="wp-icon" aria-hidden="true">${w.icon}</span>
        <span class="wp-name">${esc(w.he)}</span>
        <span class="wp-meta">${esc(meta)}</span>
        ${current ? `<span class="wp-bar"><span style="width:${pct}%"></span></span>` : ''}
      </button>
    </li>`;
  }).join('');

  return `<ol class="wp-strip" id="btWorlds" aria-label="התקדמות בעולמות">${nodes}</ol>`;
}

/** Wire the strip: every node explains itself, the current one leads to the gate. */
function wireWorldStrip(main: HTMLElement, store: DataStore): void {
  main.querySelectorAll<HTMLButtonElement>('.wp-btn[data-world]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset['world']);
      const game = gameOf(store);
      const world = worldById(id);
      const boss = worldBossOf(id);
      const cleared = boss !== undefined && game.battle.bossesDefeated.includes(boss.id);

      if (id !== game.battle.world) {
        toast(
          cleared
            ? `🏆 ${world.he} — הושלם.`
            : `🔒 ${world.he} עדיין נעול — הפילו קודם את בוס ${worldById(id - 1).he}.`,
        );
        return;
      }
      if (cleared && isEndgame(game.battle.bossesDefeated)) {
        toast(`👑 מצב אלוף — הגלים ב${world.he} ממשיכים בלי סוף.`);
        return;
      }
      // The gate card below already renders the full met/unmet list — go there
      // instead of saying the same thing twice in two shapes.
      const gate = worldGate(id, partLevels(game));
      const missing = gate.requirements
        .filter((r) => !r.met)
        .map((r) => `${BODY_PART_HE[r.part]} רמה ${r.need}`)
        .join(' · ');
      toast(gate.locked ? `🔒 חסר לבוס: ${missing}` : `✓ בוס ${world.he} פתוח — הגיעו לגל ${BALANCE.combat.wavesPerWorld + 1}.`);
      const card = main.querySelector('.bt-gate');
      if (card && typeof card.scrollIntoView === 'function') {
        try {
          card.scrollIntoView({ block: 'center' });
        } catch {
          /* older engines: the card is simply left where it is */
        }
      }
    });
  });
}

/**
 * The world-boss card: the sprite, the body-part gate with met/unmet states and
 * — once every requirement is met — the promise that the fight starts by itself.
 *
 * When the world's boss is already a trophy the card turns into the endgame
 * banner instead (there is nothing left to gate in the last world).
 */
function gateCard(game: GameState): string {
  const boss = worldBossOf(game.battle.world);
  if (!boss) return '';
  const done = game.battle.bossesDefeated.includes(boss.id);
  if (done) {
    return `
    <section class="game-card bt-gate champion">
      <h3 class="gc-title">👑 ${esc(boss.he)} הובס <span class="gc-sub">מצב אלוף</span></h3>
      <div class="bt-gate-body">
        <div class="bt-gate-sprite defeated">${boss.svg}</div>
        <p class="gc-note">
          העולם הזה כבר שלכם. הגלים ממשיכים להגיע ולהתחזק בלי גבול — כל גל נוסף הוא שיא אישי חדש,
          והגביע מחכה לכם בלשונית 🦸 דמות.
        </p>
      </div>
    </section>`;
  }

  const gate = worldGate(game.battle.world, partLevels(game));
  const wavesLeft = Math.max(0, BALANCE.combat.wavesPerWorld - (game.battle.wave - 1));
  const spec = bossSpec(game.battle.world);
  const reqs = gate.requirements
    .map(
      (r) => `<li class="${r.met ? 'met' : 'unmet'}">
        ${r.met ? '✓' : '✕'} ${BODY_PART_HE[r.part]} רמה ${r.need}
        <span>(כרגע ${r.have})</span>
      </li>`,
    )
    .join('');
  const missing = gate.requirements.filter((r) => !r.met);
  const missingHe = missing.map((r) => `${BODY_PART_HE[r.part]} רמה ${r.need}`).join(' · ');

  return `
  <section class="game-card bt-gate ${gate.locked ? 'locked' : 'open'}">
    <h3 class="gc-title">בוס העולם: ${esc(boss.he)} <span class="gc-sub">${wavesLeft > 0 ? `עוד ${wavesLeft} גלים` : 'מחכה לכם'}</span></h3>
    <div class="bt-gate-body">
      <div class="bt-gate-sprite">${boss.svg}</div>
      <ul class="bt-reqs">${reqs}</ul>
    </div>
    <p class="gc-note">${
      gate.locked
        ? `הבוס נעול. חסר לכם: <b>${esc(missingHe)}</b> — התאמנו על החלקים האלה וזה ייפתח מעצמו.`
        : `כל הדרישות הושלמו! הקרב מתחיל לבד ברגע שתגיעו לגל ${BALANCE.combat.wavesPerWorld + 1}${
            spec ? ` · עולה ${spec.energyCost} ⚡ · מזכה ב־${spec.coins} 🪙` : ''
          }.`
    }</p>
  </section>`;
}

/* ----------------------------------------------------------------- driver */

function start(main: HTMLElement, deps: BattleDeps): void {
  const { store } = deps;
  const el = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
    main.querySelector<T>(`#${id}`);

  const arena = el('btArena');
  const fx = el('btFx');
  const enemyBtn = el<HTMLButtonElement>('btEnemy');
  const superBtn = el<HTMLButtonElement>('btSuper');
  const sprite = el('btEnemySprite');
  const heroSprite = el('btHeroSprite');
  const foeName = el('btFoeName');
  const foeHp = el('btFoeHp');
  const foeHpTxt = el('btFoeHpTxt');
  const heroHp = el('btHeroHp');
  const heroHpTxt = el('btHeroHpTxt');
  const statusEl = el('btStatus');
  const waveEl = el('btWave');
  const energyEl = el('btEnergy');
  const energyBar = el('btEnergyBar');
  const superBar = el('btSuperBar');
  const superPct = el('btSuperPct');
  const coinsEl = el('btCoins');
  const clearedEl = el('btCleared');
  const minisEl = el('btMinis');
  const bossesEl = el('btBosses');
  if (!arena) return;

  /** Is the CURRENT world's boss gate open for this character right now? */
  const gateOpenFor = (g: GameState): boolean => !worldGate(g.battle.world, partLevels(g)).locked;

  const game0 = gameOf(store);
  let stats = statsOf(game0);
  const state = createBattle({
    // The seed is per SESSION: nothing in the persisted state depends on it, and
    // the seed each cleared wave actually ran with is recorded in its event.
    seed: Math.floor(Date.now() % 0xffffffff) ^ 0x5f356495,
    world: game0.battle.world,
    wave: game0.battle.wave,
    energy: game0.energy,
    stats,
    gateOpen: gateOpenFor(game0),
    defeatedBosses: game0.battle.bossesDefeated,
  });

  const softMotion = reducedMotion();
  // Hand the CSS the same durations this file computed from BALANCE — one source
  // of truth for anything that has to stay in step with the simulation.
  arena.style.setProperty('--anim-atk', `${ANIM.attack}ms`);
  arena.style.setProperty('--anim-hit', `${ANIM.hit}ms`);
  arena.style.setProperty('--anim-die', `${ANIM.die}ms`);
  arena.style.setProperty('--anim-super', `${ANIM.super}ms`);
  arena.style.setProperty('--anim-victory', `${ANIM.victory}ms`);
  /**
   * Rebuild the arena AFTER the current frame: `consume()` runs inside the
   * simulation loop, and tearing the DOM down from inside it would be re-entrant.
   */
  function queueRemount(): void {
    if (!deps.remount) return;
    setTimeout(() => {
      if (!disposed) deps.remount?.();
    }, 900);
  }

  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  let running = false;
  let disposed = false;

  /* ------------------------------------------------------------ rendering */

  // Cosmetic jitter for the damage numbers — a counter, not Math.random, so the
  // screen is as reproducible as the simulation behind it.
  let jitter = 0;
  function float(text: string, cls: string, side: 'hero' | 'enemy'): void {
    if (!fx) return;
    jitter = (jitter + 3) % 7;
    const d = document.createElement('div');
    d.className = `bt-float ${cls} ${side}`;
    d.textContent = text;
    // inset-inline-start = the right edge in RTL, where the hero stands.
    d.style.insetInlineStart = `${(side === 'hero' ? 14 : 60) + jitter * 2.5}%`;
    d.style.top = `${24 + jitter * 3}%`;
    fx.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  function shake(strong: boolean): void {
    if (softMotion || !arena) return;
    const cls = strong ? 'shake-strong' : 'shake';
    arena.classList.remove('shake', 'shake-strong');
    // reflow so the animation restarts even on consecutive hits
    void arena.offsetWidth;
    arena.classList.add(cls);
    setTimeout(() => arena.classList.remove(cls), strong ? 480 : 220);
  }

  /**
   * Play one short-lived animation class on an element.
   *
   * Unlike `shake()` this is NOT skipped under `prefers-reduced-motion`: the
   * class is a marker, and the global reduced-motion rule already switches the
   * keyframes off (every arena animation rests at the identity transform, so a
   * suppressed one leaves nothing displaced). Skipping the class here instead
   * would mean two places to keep in sync — and the death marker also has to
   * come off again either way.
   *
   * Re-triggering on a consecutive hit needs the class removed AND a reflow, or
   * the browser sees no change and the animation never restarts.
   */
  const animTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function anim(target: HTMLElement | null, cls: string, ms: number): void {
    if (!target) return;
    const key = `${target.id}:${cls}`;
    const pending = animTimers.get(key);
    if (pending) clearTimeout(pending);
    target.classList.remove(cls);
    void target.offsetWidth;
    target.classList.add(cls);
    animTimers.set(
      key,
      setTimeout(() => {
        animTimers.delete(key);
        target.classList.remove(cls);
      }, ms),
    );
  }

  function clearAnimTimers(): void {
    for (const t of animTimers.values()) clearTimeout(t);
    animTimers.clear();
  }

  function paintEnemy(): void {
    const e = state.enemy;
    if (!sprite || !foeName || !foeHp || !foeHpTxt) return;
    if (!e) {
      foeHp.style.width = '0%';
      foeHpTxt.textContent = '';
      return;
    }
    foeHp.style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
    foeHpTxt.textContent = `${Math.max(0, Math.round(e.hp))} / ${Math.round(e.maxHp)}`;
  }

  function spawnSprite(): void {
    const e = state.enemy;
    if (!sprite || !foeName || !e) return;
    sprite.innerHTML = e.svg;
    // The previous occupant died on this node — clear its death marker, and give
    // the newcomer its own idle rhythm.
    sprite.classList.remove('anim-die', 'anim-hit', 'anim-attack');
    sprite.style.setProperty('--en-bob', `${bobDuration(e.id)}ms`);
    sprite.classList.toggle('mini-boss', e.miniBoss);
    sprite.classList.toggle('world-boss', e.worldBoss);
    arena?.classList.toggle('boss-fight', e.worldBoss);
    foeName.textContent = e.worldBoss ? `🏛 ${e.he}` : e.miniBoss ? `👑 ${e.he}` : e.he;
    paintEnemy();
  }

  function paintHero(): void {
    if (!heroHp || !heroHpTxt) return;
    const pct = state.maxHp > 0 ? (state.playerHp / state.maxHp) * 100 : 0;
    heroHp.style.width = `${Math.max(0, pct)}%`;
    heroHp.classList.toggle('low', pct < 30);
    heroHpTxt.textContent = `${Math.max(0, Math.round(state.playerHp))} / ${Math.round(state.maxHp)}`;
  }

  function paintMeters(): void {
    const perWave = BALANCE.combat.energyPerWave;
    if (energyEl) energyEl.textContent = fmtXp(state.energy);
    if (energyBar) {
      // The bar shows "waves left", capped at 10 waves' worth — a full bar means
      // "plenty", an empty one means "go train".
      energyBar.style.width = `${Math.min(100, (state.energy / (perWave * 10)) * 100)}%`;
    }
    if (superBar) superBar.style.width = `${Math.round(state.superMeter * 100)}%`;
    if (superPct) superPct.textContent = `${Math.round(state.superMeter * 100)}%`;
    if (superBtn) {
      const ready = superReady(state) && state.status === 'fighting';
      superBtn.disabled = !ready;
      superBtn.classList.toggle('ready', ready);
    }
    if (waveEl) waveEl.textContent = String(state.wave);
  }

  function paintStatus(): void {
    if (!statusEl) return;
    let text = '';
    let cls = '';
    switch (state.status) {
      case 'resting':
        text = `😴 אין מספיק אנרגיה — הדמות נחה. לכו להתאמן! כל סט מסומן שווה ${BALANCE.energy.perSet} ⚡ וסיום אימון עוד ${BALANCE.energy.perWorkout} ⚡.`;
        cls = 'rest';
        break;
      case 'gated': {
        const gate = worldGate(state.world, partLevels(gameOf(store)));
        const missing = gate.requirements
          .filter((r) => !r.met)
          .map((r) => `${BODY_PART_HE[r.part]} רמה ${r.need}`)
          .join(' · ');
        text = `🏛 בוס העולם חוסם את הדרך. חסר: ${missing || 'אימון'} — לכו להתאמן ותחזרו.`;
        cls = 'gate';
        break;
      }
      case 'recovering':
        text = `💀 הופלתם בגל ${state.wave} — הדמות קמה ומנסה שוב.`;
        cls = 'down';
        break;
      default:
        if (state.enemy?.worldBoss) {
          text = `🏛 קרב בוס! ${state.enemy.he} — הקישו בלי הפסקה ושחררו כל מהלך על.`;
          cls = 'boss';
        } else {
          text =
            state.streakDefeats >= BALANCE.combat.defeatsBeforeHint
              ? '⚠️ האויב חזק מדי. לכו להתאמן כדי להעלות רמות — הסטטיסטיקות הן ההבדל.'
              : 'הקישו על האויב כדי לתקוף ולטעון את מד מהלך העל.';
          cls = state.streakDefeats >= BALANCE.combat.defeatsBeforeHint ? 'warn' : '';
        }
    }
    statusEl.textContent = text;
    statusEl.className = `bt-status ${cls}`;
  }

  function paintTotals(): void {
    const g = gameOf(store);
    if (coinsEl) coinsEl.textContent = fmtXp(g.battle.coins);
    if (clearedEl) clearedEl.textContent = String(g.battle.wavesCleared);
    if (minisEl) minisEl.textContent = String(g.battle.miniBossesCleared);
    if (bossesEl) bossesEl.textContent = String(g.battle.bossesDefeated.length);
  }

  /* --------------------------------------------------------------- events */

  function consume(events: readonly CombatEvent[]): void {
    for (const ev of events) {
      switch (ev.kind) {
        case 'spawn':
          spawnSprite();
          break;
        case 'boss_spawn':
          spawnSprite();
          shake(true);
          toast(`🏛 בוס העולם ${ev.spec.boss.he} הופיע!`);
          break;
        case 'hit':
          paintEnemy();
          float(
            `${ev.crit ? '💥' : ''}${fmtXp(ev.amount)}`,
            ev.source === 'super' ? 'super' : ev.crit ? 'crit' : 'dmg',
            'enemy',
          );
          // The lunge is per ATTACK EVENT, which is what keeps it in step with a
          // Shoulders-driven attack interval that changes as the player trains —
          // there is no separate animation clock to drift.
          if (ev.source !== 'super') anim(heroSprite, 'anim-attack', ANIM.attack);
          anim(sprite, 'anim-hit', ANIM.hit);
          if (ev.source === 'super') shake(true);
          break;
        case 'enemy_hit':
          paintHero();
          float(`-${fmtXp(ev.amount)}`, 'foe', 'hero');
          anim(sprite, 'anim-attack', ANIM.attack);
          anim(heroSprite, 'anim-hurt', ANIM.hit);
          break;
        case 'regen':
          paintHero();
          if (ev.amount > 0) float(`+${fmtXp(ev.amount)}`, 'heal', 'hero');
          break;
        case 'wave_cleared': {
          // The enemy is already gone from the state; the sprite plays out its
          // collapse in the `spawnDelayMs` gap before the next one takes over.
          anim(sprite, 'anim-die', ANIM.die);
          // THE persisted battle fact — one event per wave, nothing per tick.
          onWaveCleared(store, ev.result);
          // Re-sync from the store: it, not the battle, owns the energy.
          setEnergy(state, gameOf(store).energy);
          paintTotals();
          deps.refreshHeader();
          float(`+${ev.result.coins} 🪙`, 'coin', 'enemy');
          break;
        }
        case 'boss_defeated': {
          anim(sprite, 'anim-die', ANIM.die);
          anim(heroSprite, 'anim-victory', ANIM.victory);
          // The one persisted boss fact: trophy + purse + world unlock.
          onBossDefeated(store, ev.result);
          const g = gameOf(store);
          setEnergy(state, g.energy);
          setGate(state, gateOpenFor(g), g.battle.bossesDefeated);
          paintTotals();
          deps.refreshHeader();
          shake(true);
          float(`+${ev.result.coins} 🪙`, 'coin', 'enemy');
          arena?.classList.remove('boss-fight');
          sprite?.classList.remove('world-boss');
          toast(
            ev.result.endgame
              ? '👑 זאוס הובס! נפתח מצב אלוף — הגלים ממשיכים בלי סוף.'
              : `🏛 בוס העולם הובס! עולם ${ev.result.nextWorld} נפתח.`,
          );
          // The whole screen changes (new world, new gate card) — remount it.
          queueRemount();
          break;
        }
        case 'defeat':
          paintHero();
          anim(heroSprite, 'anim-hurt', ANIM.hit);
          shake(true);
          break;
        case 'super_ready':
        case 'resting':
        case 'gated':
          break;
      }
    }
    paintHero();
    paintMeters();
    paintStatus();
  }

  /* ----------------------------------------------------------- the loop */

  function frame(now: number): void {
    if (disposed || !running) return;
    const dt = last === 0 ? 0 : now - last;
    last = now;
    // Level-ups can happen while the tab is open (another device, an import) —
    // re-derive the stats every frame; it is a handful of multiplications. The
    // boss gate rides along, so hitting the required level while the arena is on
    // screen releases a `gated` battle straight into the boss fight.
    const g = gameOf(store);
    stats = statsOf(g);
    if (state.status === 'gated') setGate(state, gateOpenFor(g), g.battle.bossesDefeated);
    consume(advance(state, dt, stats));
    schedule();
  }

  function schedule(): void {
    if (disposed || !running) return;
    if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(frame);
    } else {
      timer = setTimeout(() => frame(Date.now()), BALANCE.combat.tickMs);
    }
  }

  function resume(): void {
    if (disposed || running) return;
    running = true;
    last = 0; // a pause never banks time
    schedule();
  }

  function pause(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = null;
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') pause();
    else resume();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', pause);

  /* --------------------------------------------------------------- input */

  enemyBtn?.addEventListener('click', () => {
    stats = statsOf(gameOf(store));
    const res = tap(state, stats);
    if (!res.accepted) return;
    shake(false);
    consume(res.events);
  });

  superBtn?.addEventListener('click', () => {
    stats = statsOf(gameOf(store));
    const res = useSuper(state, stats);
    // The wind-up pose goes on BEFORE the events are drawn, so the pop and the
    // damage number land together rather than the hero reacting a beat late.
    if (res.accepted) anim(heroSprite, 'anim-super', ANIM.super);
    consume(res.events);
  });

  active = {
    stop: () => {
      disposed = true;
      pause();
      clearAnimTimers();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', pause);
    },
  };

  // One synchronous tick so the arena is never blank on the first paint: it
  // spawns the wave's enemy (or goes straight to "rest" when there is no ⚡).
  consume(advance(state, BALANCE.combat.tickMs, stats));
  paintHero();
  paintMeters();
  paintStatus();
  resume();
}
