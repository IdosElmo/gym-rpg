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
 *
 * THE DAILY CHALLENGE (Phase 7) rides on this same screen and this same loop.
 * Pressing ⚔️ on the daily card swaps the battle STATE for a challenge one
 * (`createChallengeBattle`) — the arena, the skill bar, the taps and the super
 * are untouched, only the context changes — and the amber `challenge` class
 * frames it. Two honesty rules live here:
 *   - one run is recorded exactly ONCE, when it ends: cleared, knocked out, or
 *     FORFEITED because the player left the arena (`stopBattle()` commits it).
 *     Nothing is written per wave, so a run that is abandoned can never leak
 *     partial coins and can never be replayed for a better score;
 *   - a browser that is killed outright mid-run (a refresh, a crash) writes
 *     nothing at all: the attempt is not spent, the coins are not paid, the run
 *     is simply gone. Backgrounding the tab only PAUSES, exactly like a campaign
 *     battle.
 *
 * THE GHOST DUEL (Phase 8) rides on the very same swap, one card lower: a
 * looked-up opponent becomes a one-wave challenge run (`ghostRun`), the arena
 * turns violet instead of amber, and both HP bars are labelled by NAME because
 * both sides are now people. Everything above still holds — one event, written
 * once, when the duel ends however it ends — with three differences worth
 * naming here:
 *   - the opponent is DRAWN, not sprited: the run carries their character SVG
 *     (built in this file, mirrored by the stylesheet), while `core/ghost.ts`
 *     owns every number behind it;
 *   - the fetched payload is normalised before it can reach the engine, so a
 *     hostile row cannot influence a single stat;
 *   - the purse depends on the OUTCOME, not on the waves: a duel banks nothing
 *     per wave, and the single event written when it ends pays `winCoins` or
 *     `lossCoins` (leaving mid-duel records the loss, and is paid as one). The
 *     one-duel-per-opponent-per-day ledger is what bounds it.
 */

import { BALANCE } from '../core/balance.ts';
import {
  advance,
  bossSpec,
  bossStanding,
  createBattle,
  createChallengeBattle,
  forfeitChallenge,
  isEndgame,
  requestBossFight,
  bossHandicap,
  setEnergy,
  setGate,
  skillPower,
  skillUnlockLevel,
  skillUnlocked,
  skillViews,
  superReady,
  tap,
  useSkill,
  useSuper,
  waveSpec,
  worldGate,
  type ChallengeResult,
  type ChallengeRun,
  type CombatEvent,
  type CombatStats,
  type SkillView,
} from '../core/combat.ts';
import { dailyChallenge, dailyRun } from '../core/daily.ts';
import { ghostHash, ghostRun, normalizeGhost, type GhostPayload } from '../core/ghost.ts';
import { checkHandle } from '../core/handle.ts';
import {
  dailyStatus,
  gameOf,
  ghostDuelStatus,
  onBossDefeated,
  onDailyChallenge,
  onGhostDuel,
  onWaveCleared,
} from '../core/game.ts';
import { duelCoins, statsOfGame } from '../core/xp.ts';
import { todayISO } from '../core/workout.ts';
import { BODY_PARTS, type BodyPart } from '../data/program.ts';
import {
  SKILLS,
  SKILL_IDS,
  WORLDS,
  WORLD_COUNT,
  bossWaveOf,
  wavesInWorld,
  worldById,
  worldBossOf,
  type GateStatus,
  type SkillId,
} from '../data/gameContent.ts';
import type { DataStore, GameState } from '../storage/DataStore.ts';
import { gateCoaching, type GateCoaching } from '../core/coaching.ts';
import { resolveProgram } from '../core/plan.ts';
import { characterSvg } from './characterSvg.ts';
import {
  emptyGhostView,
  ghostCard,
  ghostFigure,
  type GhostCardView,
  type GhostDuelDeps,
} from './ghost.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { fmtXp } from './xpfx.ts';
import { tr } from '../i18n/locale.ts';
import { battle as M } from '../i18n/messages/battle.ts';
import { character as CM } from '../i18n/messages/character.ts';
import { ghost as GM } from '../i18n/messages/ghost.ts';
import { bodyPartName, exName } from '../i18n/content.ts';
import { fmtDayMonth } from '../i18n/format.ts';
import { foeName, skillDesc, skillName, skillSummary, worldName, worldTagline } from '../i18n/gameText.ts';

export interface BattleDeps {
  store: DataStore;
  /** Re-render the shell (the header energy pill follows the battle). */
  refreshHeader: () => void;
  /**
   * The ghost-duel plumbing, when this build has an account behind it. Absent
   * (offline build, `file://`, signed out) means the duel card is not rendered
   * at all — the same gating the account card uses.
   */
  ghost?: GhostDuelDeps;
  /**
   * Rebuild the whole arena. Called after a world boss falls, because the world,
   * the enemy roster and the gate card all change at once.
   */
  remount?: () => void;
  /** Open the plan editor — the gate coaching's "add this to your plan" shortcut. */
  editPlan?: () => void;
}

interface Runtime {
  stop: () => void;
}

/** Only one battle can be live at a time; the app stops it on every tab switch. */
let active: Runtime | null = null;

/**
 * The dev panel's one reach into the arena: zero the skill cooldowns of the
 * battle that is CURRENTLY on screen. Set while an arena is mounted, cleared
 * when it is torn down.
 *
 * Cooldowns are in-memory runtime (`core/combat.ts`), never persisted, so this
 * writes NO event — there is nothing about a screen for the log to remember. It
 * also means the useful call site is the console during a fight: leaving the
 * arena already resets them, which is why "no battle running" is an honest
 * answer rather than a failure.
 */
let cooldownReset: (() => void) | null = null;

export function stopBattle(): void {
  active?.stop();
  active = null;
  cooldownReset = null;
}

/** Zero the live battle's skill cooldowns. False when no battle is on screen. */
export function devResetCooldowns(): boolean {
  if (!cooldownReset) return false;
  cooldownReset();
  return true;
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

/**
 * The seed of one campaign battle SESSION. Nothing persisted depends on it (each
 * cleared wave records the seed it actually ran with), so the clock is a fine
 * source here — unlike the daily challenge, whose seed is the DATE and nothing
 * else, so that every device faces the same gauntlet.
 */
function sessionSeed(): number {
  return Math.floor(Date.now() % 0xffffffff) ^ 0x5f356495;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** "חזה רמה 5" / "Chest Lv 5" — a body part at a level, in the reader's language. */
function partLevel(part: BodyPart, level: number): string {
  return tr(M).partLevel(bodyPartName(part), level);
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
  /** A skill: the hero's pose, the trained part's flex and the screen flash. */
  skill: 520,
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
  const T = tr(M);
  const S = tr(CM).stats;

  main.innerHTML = `
  <section class="bt-card">
    <div class="bt-worldbar">
      <div class="bt-world">
        <b>${esc(worldName(world))}${champion ? ' 👑' : ''}</b>
        <span>${T.world.of(world.id, WORLD_COUNT)} · ${esc(champion ? T.world.championTagline : worldTagline(world))}</span>
      </div>
      <div class="bt-wave"><b id="btWave">${game.battle.wave}</b><span>${T.world.waveLabel}</span></div>
    </div>

    ${worldStrip(game)}

    <div class="dc-slot" id="btDaily">${dailyCard(game, todayISO(), null)}</div>

    <div class="gd-slot" id="btGhost"></div>

    <div class="bt-arena" id="btArena" style="--w-accent:${world.accent};--w-bg1:${world.bg[0]};--w-bg2:${world.bg[1]}">
      <div class="bt-fx" id="btFx" aria-hidden="true"></div>

      <div class="bt-side bt-hero">
        <div class="bt-buffs" id="btBuffs" aria-live="off"></div>
        <div class="bt-sprite hero" id="btHeroSprite">${characterSvg(game.parts, {
          label: T.arena.heroLabel,
          // The arena fights with whoever the דמות screen selected…
          character: game.characters.selected,
          // …WEARING what that screen shows them wearing. `GameState['equipment']`
          // IS an `EquipmentView` (equipped + upgrades), so the arena hero and the
          // דמות stage are drawn from one and the same wardrobe — buy a belt, put
          // it on, and it is on the fighter, upgrade flair included. This is the
          // only place the hero is drawn: the daily gauntlet and the ghost duel
          // swap the battle's CONTEXT, never the sprite, so passing it here covers
          // campaign waves, mini-bosses, world bosses, champion mode, the daily
          // run and a duel alike.
          equipment: game.equipment,
        })}</div>
        <div class="bt-bar hp"><span id="btHeroHp" style="width:100%"></span></div>
        <div class="bt-hp-txt" id="btHeroHpTxt">${Math.round(stats.maxHp)} / ${Math.round(stats.maxHp)}</div>
        <!-- Empty except in a duel, where both HP bars are labelled by NAME:
             "who is losing" has to be readable when both sides are people. -->
        <div class="bt-hero-name" id="btHeroName"></div>
      </div>

      <div class="bt-vs" id="btVs">VS</div>

      <button class="bt-side bt-enemy" id="btEnemy" type="button" aria-label="${esc(T.arena.attack)}">
        <div class="bt-sprite enemy" id="btEnemySprite">${spec ? spec.enemy.svg : ''}</div>
        <div class="bt-bar foe"><span id="btFoeHp" style="width:100%"></span></div>
        <div class="bt-hp-txt" id="btFoeHpTxt"></div>
        <div class="bt-foe-name" id="btFoeName">${spec ? esc(foeName(spec.enemy)) : ''}</div>
      </button>
    </div>

    <p class="bt-status" id="btStatus"></p>

    <!-- The boss fight starts by CHOICE: this button stands here the whole
         time the player is at the boss wave — the EARLY challenge (amber,
         the boss strengthened) while the body-part gate is unmet, the plain
         boss fight once it is met. -->
    <button class="bt-boss-btn" id="btBossFight" type="button" hidden>${T.arena.bossFight}</button>

    <div class="bt-meters">
      <div class="bt-meter">
        <div class="bm-head"><span>${T.arena.energy}</span><b id="btEnergy">${fmtXp(game.energy)}</b></div>
        <div class="bt-bar energy"><span id="btEnergyBar" style="width:0%"></span></div>
        <div class="bm-foot">${T.arena.energyFoot(BALANCE.combat.energyPerWave)}</div>
      </div>
      <div class="bt-meter">
        <div class="bm-head"><span>${T.arena.super}</span><b id="btSuperPct">0%</b></div>
        <div class="bt-bar super"><span id="btSuperBar" style="width:0%"></span></div>
        <div class="bm-foot">${T.arena.superFoot}</div>
      </div>
    </div>

    ${skillBar(game)}

    <button class="bt-super-btn" id="btSuper" disabled>${T.arena.superBtn}</button>

    <div class="bt-stats">
      <div class="cm-item"><b>🪙 <span id="btCoins">${fmtXp(game.battle.coins)}</span></b><span>${T.arena.coins}</span></div>
      <div class="cm-item"><b id="btCleared">${game.battle.wavesCleared}</b><span>${T.arena.waves}</span></div>
      <div class="cm-item"><b id="btMinis">${game.battle.miniBossesCleared}</b><span>${T.arena.minis}</span></div>
      <div class="cm-item"><b id="btBosses">${game.battle.bossesDefeated.length}</b><span>${T.arena.bosses}</span></div>
    </div>
    <p class="gc-note">${T.arena.coinsNote}</p>
  </section>

  <section class="game-card">
    <h3 class="gc-title">${T.arena.powerTitle} <span class="gc-sub">${T.arena.powerSub}</span></h3>
    <div class="stat-grid">
      <div class="stat"><span class="s-k">${S.atk}</span><b>${stats.atk}</b></div>
      <div class="stat"><span class="s-k">${S.def}</span><b>${stats.def}</b></div>
      <div class="stat"><span class="s-k">${S.hp}</span><b>${stats.maxHp}</b></div>
      <div class="stat"><span class="s-k">${S.speed}</span><b>${(stats.attackIntervalMs / 1000).toFixed(2)}s</b></div>
      <div class="stat"><span class="s-k">${S.crit}</span><b>${Math.round(stats.critChance * 100)}%</b></div>
      <div class="stat"><span class="s-k">${S.regen}</span><b>${T.arena.regen(stats.regen)}</b></div>
    </div>
    <p class="gc-note">${T.arena.offlineNote}</p>
  </section>

  ${gateCard(game, coachingOf(store, game), typeof deps.editPlan === 'function')}`;

  wireWorldStrip(main, store);
  start(main, deps);
}

/* ------------------------------------------------------------ skill bar */

/**
 * The six body-part skills as one row of slots, right above the super move.
 *
 * Order is the body-part order, so the bar reads like the character screen. A
 * LOCKED slot is not hidden — it shows 🔒 and the exact training that opens it
 * ("חזה רמה 5"), because "train this and you get that" is the whole point; and
 * it is still a real button, so a tap can explain itself in Hebrew instead of
 * doing nothing. Every slot is ≥44px in both directions.
 *
 * The lock state is DERIVED from the part levels on every paint — there is no
 * unlock flag in the state, so levelling up mid-session opens the slot without
 * a reload, exactly like the boss gate above it.
 */
function skillBar(game: GameState): string {
  const levels = partLevels(game);
  const need = skillUnlockLevel();
  const T = tr(M).skills;
  const slots = SKILLS.map((def) => {
    const unlocked = skillUnlocked(def, levels);
    const hint = partLevel(def.part, need);
    const name = skillName(def);
    return `<button class="bt-skill ${unlocked ? 'ready' : 'locked'}" type="button" data-skill="${def.id}"
      aria-label="${esc(unlocked ? T.label(name, skillSummary(def, skillPower(def, levels))) : T.lockedLabel(name, hint))}">
      <span class="sk-sweep" aria-hidden="true"></span>
      <span class="sk-glyph" aria-hidden="true">${unlocked ? def.icon : '🔒'}</span>
      <span class="sk-name">${esc(name)}</span>
      <span class="sk-sub">${esc(unlocked ? T.ready : hint)}</span>
    </button>`;
  }).join('');

  return `
    <div class="bt-skills" id="btSkills" role="group" aria-label="${esc(T.group)}">${slots}</div>
    <p class="bm-foot bt-skills-foot">${T.foot(need)}</p>`;
}

/* --------------------------------------------------------- daily challenge */

/**
 * The daily-challenge card, right under the world strip.
 *
 * It has exactly four states and renders all of them from data it is given —
 * `data-state` names the one on screen so a test (and a stylesheet) can tell
 * them apart without reading Hebrew:
 *
 *   available    the fee is affordable and today is unplayed — the ⚔️ button;
 *   locked       not enough ⚡ — the button explains what to train instead;
 *   done         today's one attempt is spent — the score, the purse, and
 *                "מחר יש אתגר חדש";
 *   live         a run is on screen — the wave counter and the forfeit warning.
 *
 * The enemy preview is the REAL gauntlet: five of the ten sprites the date will
 * actually send, drawn straight from `dailyChallenge(date)`. Nothing here is
 * random and nothing depends on the player's progress — two accounts opening the
 * app on the same day see the same row of faces.
 */
function dailyCard(game: GameState, date: string, run: ChallengeRun | null): string {
  const gauntlet = dailyChallenge(date);
  const total = gauntlet.waves.length;
  const record = game.daily.runs[date] ?? null;
  const fee = gauntlet.energyCost;
  const live = run !== null && run.outcome === 'running';
  const state = live ? 'live' : record ? 'done' : game.energy < fee ? 'locked' : 'available';
  const T = tr(M).daily;

  // Waves 2/4/6/8/10 — a taste of the tour, ending on the finale mini-boss.
  const preview = gauntlet.waves
    .filter((w) => w.index % 2 === 0)
    .map(
      (w) =>
        `<span class="dc-foe ${w.miniBoss ? 'mini' : ''}" title="${esc(T.foeTitle(w.index, foeName(w)))}"
          aria-hidden="true">${w.svg}</span>`,
    )
    .join('');

  const streak = game.daily.streak;
  const stats = [
    game.daily.bestScore > 0 ? T.best(game.daily.bestScore, total) : '',
    game.daily.completed > 0 ? T.completed(game.daily.completed) : '',
    streak > 1 ? T.streak(streak) : '',
  ]
    .filter((s) => s !== '')
    .join(' · ');

  let body: string;
  if (live && run) {
    const at = Math.min(run.index + 1, total);
    const pct = Math.round((run.cleared / total) * 100);
    body = `
      <div class="dc-live">
        <b class="dc-count">${T.liveCount(at, total)}</b>
        <span class="dc-bar"><span style="width:${pct}%"></span></span>
      </div>
      <p class="dc-note">${T.liveNote}</p>`;
  } else if (record) {
    body = `
      <div class="dc-result">
        <b class="dc-score">${record.score}/${total}</b>
        <span>${record.complete ? T.full : T.doneToday} · +${record.coins} 🪙</span>
      </div>
      <p class="dc-note">${T.doneNote}</p>`;
  } else if (state === 'locked') {
    body = `
      <button class="dc-go locked" id="btDailyGo" type="button">${T.lockedBtn(fee)}</button>
      <p class="dc-note">${T.lockedNote(fmtXp(game.energy), fee, BALANCE.energy.perSet)}</p>`;
  } else {
    body = `
      <button class="dc-go" id="btDailyGo" type="button">${T.go(fee)}</button>
      <p class="dc-note">${T.goNote(total)}</p>`;
  }

  return `
  <section class="dc" data-state="${state}" aria-label="${esc(T.label)}">
    <div class="dc-head">
      <span class="dc-chip">${T.chip}</span>
      <span class="dc-date">${esc(fmtDayMonth(date))}</span>
      ${stats ? `<span class="dc-stats">${esc(stats)}</span>` : ''}
    </div>
    <div class="dc-foes">${preview}</div>
    ${body}
  </section>`;
}

/* ------------------------------------------------------ world progress strip */

/**
 * The nine worlds as one compact row of nodes, directly under the world bar.
 *
 * It answers the three questions the arena could not answer before without
 * scrolling: where am I in the run, how far into THIS world am I, and is the
 * boss at the end of it open yet. Each node carries the world's icon, its Hebrew
 * name and one status glyph:
 *
 *   🏆 the world's boss is a trophy      ✓ the gate is met — the boss is ready
 *   🔒 locked (a future world, or a gate that still wants training)
 *   👑 champion mode — the last boss is down and the final world runs forever
 *
 * The current node also carries `גל 23/50` — the denominator is that world's OWN
 * wave count — and a hairline progress bar. Tapping any node explains it in
 * Hebrew; tapping the CURRENT one scrolls to the gate card that already renders
 * the full met/unmet list, rather than duplicating it.
 *
 * NINE NODES ON A PHONE. The strip was a four-column grid; nine columns would be
 * ~34px wide on a 360px screen, under the app's 44px touch floor. It is now a
 * horizontally SCROLLING flex row with a fixed node width (the same pattern the
 * inner tab rows use), and the current node is `scrollIntoView`-ed on mount so
 * the player always opens on themselves rather than on world 1.
 */
/**
 * The coaching behind the current world's gate, from the store: the active
 * plan (built-in when none was edited), the whole log for the recent pace, and
 * today. `null` when the gate is met — there is nothing to coach.
 */
function coachingOf(store: DataStore, game: GameState): GateCoaching | null {
  const gate = worldGate(game.battle.world, partLevels(game));
  if (!gate.locked) return null;
  const program = resolveProgram(store.getState().plan);
  return gateCoaching(game, gate, program, store.getEvents(), todayISO());
}

/** `+40` for a deficit of two — the extra HP the early boss carries, in percent. */
function handicapPct(deficit: number): number {
  return Math.round((bossHandicap(deficit).hp - 1) * 100);
}

/** The same, for its damage. */
function handicapAtkPct(deficit: number): number {
  return Math.round((bossHandicap(deficit).atk - 1) * 100);
}

function worldStrip(game: GameState): string {
  const cur = game.battle.world;
  const wave = game.battle.wave;
  const champion = isEndgame(game.battle.bossesDefeated);
  const gate = worldGate(cur, partLevels(game));
  const T = tr(M).strip;

  const nodes = WORLDS.map((w) => {
    const perWorld = w.waves;
    const boss = worldBossOf(w.id);
    const cleared = boss !== undefined && game.battle.bossesDefeated.includes(boss.id);
    const current = w.id === cur;
    const locked = !cleared && !current;
    const championHere = current && champion;

    const glyph = championHere ? '👑' : cleared ? '🏆' : locked ? '🔒' : gate.locked ? '⚔️' : '✓';
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
    if (championHere) meta = T.wave(wave);
    else if (current) meta = wave > perWorld ? T.bossFight : T.waveOf(wave, perWorld);
    else if (cleared) meta = T.done;
    else meta = T.locked;

    const pct = current && !champion ? Math.min(100, Math.round(((wave - 1) / perWorld) * 100)) : 0;
    const label = `${worldName(w)} · ${meta}${current ? (gate.locked ? T.bossEarly : T.bossOpen) : ''}`;

    return `<li class="wp-node ${state}"${current ? ' data-current="1"' : ''}>
      <button class="wp-btn" type="button" data-world="${w.id}" aria-label="${esc(label)}"
        ${current ? 'aria-current="step"' : ''}>
        <span class="wp-glyph" aria-hidden="true">${glyph}</span>
        <span class="wp-icon" aria-hidden="true">${w.icon}</span>
        <span class="wp-name">${esc(worldName(w))}</span>
        <span class="wp-meta">${esc(meta)}</span>
        ${current ? `<span class="wp-bar"><span style="width:${pct}%"></span></span>` : ''}
      </button>
    </li>`;
  }).join('');

  return `<ol class="wp-strip" id="btWorlds" aria-label="${esc(T.label)}">${nodes}</ol>`;
}

/** Wire the strip: every node explains itself, the current one leads to the gate. */
function wireWorldStrip(main: HTMLElement, store: DataStore): void {
  // Nine worlds no longer fit side by side, so the row scrolls — open it on the
  // player. `inline: 'center'` keeps the neighbours visible on both sides, which
  // is what makes it read as a path rather than as a cropped list.
  const here = main.querySelector('.wp-node[data-current="1"]');
  if (here && typeof here.scrollIntoView === 'function') {
    try {
      here.scrollIntoView({ block: 'nearest', inline: 'center' });
    } catch {
      /* older engines: the strip simply starts at world 1 */
    }
  }
  main.querySelectorAll<HTMLButtonElement>('.wp-btn[data-world]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset['world']);
      const game = gameOf(store);
      const world = worldById(id);
      const boss = worldBossOf(id);
      const cleared = boss !== undefined && game.battle.bossesDefeated.includes(boss.id);
      const T = tr(M).strip;

      if (id !== game.battle.world) {
        toast(
          cleared
            ? T.toastDone(worldName(world))
            : T.toastLocked(worldName(world), worldName(worldById(id - 1))),
        );
        return;
      }
      if (cleared && isEndgame(game.battle.bossesDefeated)) {
        toast(T.toastChampion(worldName(world)));
        return;
      }
      // The gate card below already renders the full met/unmet list — go there
      // instead of saying the same thing twice in two shapes.
      const gate = worldGate(id, partLevels(game));
      const missing = gate.requirements
        .filter((r) => !r.met)
        .map((r) => partLevel(r.part, r.need))
        .join(' · ');
      toast(
        gate.locked
          ? T.toastGated(missing, handicapPct(gate.deficit))
          : T.toastOpen(worldName(world), bossWaveOf(id)),
      );
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
function gateCard(game: GameState, coaching: GateCoaching | null, canEditPlan: boolean): string {
  const boss = worldBossOf(game.battle.world);
  if (!boss) return '';
  const done = game.battle.bossesDefeated.includes(boss.id);
  const T = tr(M).gate;
  const bossName = esc(foeName(boss));
  if (done) {
    return `
    <section class="game-card bt-gate champion">
      <h3 class="gc-title">${T.championTitle(bossName)} <span class="gc-sub">${T.championSub}</span></h3>
      <div class="bt-gate-body">
        <div class="bt-gate-sprite defeated">${boss.svg}</div>
        <p class="gc-note">
          ${T.championNote}
        </p>
      </div>
    </section>`;
  }

  const gate = worldGate(game.battle.world, partLevels(game));
  const wavesLeft = Math.max(0, wavesInWorld(game.battle.world) - (game.battle.wave - 1));
  const spec = bossSpec(game.battle.world);
  const reqs = gate.requirements
    .map(
      (r) => `<li class="${r.met ? 'met' : 'unmet'}">
        ${r.met ? '✓' : '✕'} ${partLevel(r.part, r.need)}
        <span>${T.now(r.have)}</span>
      </li>`,
    )
    .join('');
  const missing = gate.requirements.filter((r) => !r.met);
  const missingText = missing.map((r) => partLevel(r.part, r.need)).join(' · ');
  const coach = gate.locked && coaching ? coachingBlock(coaching, canEditPlan) : '';

  return `
  <section class="game-card bt-gate ${gate.locked ? 'locked' : 'open'}">
    <h3 class="gc-title">${T.title(bossName)} <span class="gc-sub">${wavesLeft > 0 ? T.wavesLeft(wavesLeft) : T.waiting}</span></h3>
    <div class="bt-gate-body">
      <div class="bt-gate-sprite">${boss.svg}</div>
      <ul class="bt-reqs">${reqs}</ul>
    </div>
    <p class="gc-note">${
      gate.locked
        ? T.lockedNote(
            esc(missingText),
            bossWaveOf(game.battle.world),
            handicapPct(gate.deficit),
            handicapAtkPct(gate.deficit),
          )
        : T.openNote(bossWaveOf(game.battle.world), spec ? { energy: spec.energyCost, coins: spec.coins } : null)
    }</p>
    ${coach}
  </section>`;
}

/**
 * THE COACHING behind an unmet gate (`core/coaching.ts`): for every missing
 * part, how many sets a week the plan gives it, what could be added, and how
 * many workouts away it is at the recent pace — so the wait has a shape and a
 * lever, instead of being a number the player cannot move.
 */
function coachingBlock(c: GateCoaching, canEditPlan: boolean): string {
  if (c.parts.length === 0) return '';
  const T = tr(M).coach;
  const eta =
    c.workoutsLeft === null
      ? c.measuredOver === 0
        ? T.noPace
        : ''
      : T.eta(c.measuredOver, c.workoutsLeft);
  const rows = c.parts
    .map((p) => {
      const left = p.workoutsLeft === null ? '' : T.left(p.workoutsLeft);
      const add =
        p.suggestions.length > 0
          ? `<span class="bt-coach-add">${T.add(p.suggestions.map((e) => esc(exName(e))).join(' · '))}</span>`
          : '';
      return `<li data-part="${p.part}">
        <b>${bodyPartName(p.part)}</b> ${p.have}→${p.need}
        <span class="bt-coach-sets">${T.sets(p.setsPerWeek, left)}</span>
        ${add}
      </li>`;
    })
    .join('');
  return `
    <div class="bt-coach">
      ${eta ? `<p class="bt-coach-eta">${eta}</p>` : ''}
      <ul class="bt-coach-list">${rows}</ul>
      ${canEditPlan ? `<button class="bt-coach-go" id="btCoachPlan" type="button">${T.editPlan}</button>` : ''}
    </div>`;
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
  const bossBtn = el<HTMLButtonElement>('btBossFight');
  const sprite = el('btEnemySprite');
  const heroSprite = el('btHeroSprite');
  const foeNameEl = el('btFoeName');
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
  const buffsEl = el('btBuffs');
  const dailyEl = el('btDaily');
  const ghostEl = el('btGhost');
  const heroName = el('btHeroName');
  if (!arena) return;

  /** The six skill slots, by id — looked up once, repainted every frame. */
  const skillBtns = new Map<SkillId, HTMLButtonElement>();
  main.querySelectorAll<HTMLButtonElement>('.bt-skill[data-skill]').forEach((btn) => {
    skillBtns.set(btn.dataset['skill'] as SkillId, btn);
  });

  /** The CURRENT world's boss gate for this character right now — met or not, and by how much. */
  const gateFor = (g: GameState): GateStatus => worldGate(g.battle.world, partLevels(g));
  /** `setGate` from a fresh read of the store: the boolean AND the early-challenge deficit. */
  const syncGate = (g: GameState, defeated?: readonly string[]): void => {
    const gate = gateFor(g);
    setGate(state, !gate.locked, defeated, gate.deficit);
  };

  const game0 = gameOf(store);
  let stats = statsOf(game0);
  /** Body-part levels — what unlocks and scales the skills. Refreshed per frame. */
  let levels = partLevels(game0);
  /**
   * THE battle on screen. It is a `let` because the daily challenge swaps the
   * whole state for a challenge context and back again — the loop, the DOM and
   * every listener below stay exactly as they are.
   */
  let state = createBattle({
    seed: sessionSeed(),
    world: game0.battle.world,
    wave: game0.battle.wave,
    energy: game0.energy,
    stats,
    gateOpen: !gateFor(game0).locked,
    gateDeficit: gateFor(game0).deficit,
    defeatedBosses: game0.battle.bossesDefeated,
    overtime: game0.battle.overtime[String(game0.battle.world)] ?? 0,
  });

  const softMotion = reducedMotion();
  // Hand the CSS the same durations this file computed from BALANCE — one source
  // of truth for anything that has to stay in step with the simulation.
  arena.style.setProperty('--anim-atk', `${ANIM.attack}ms`);
  arena.style.setProperty('--anim-hit', `${ANIM.hit}ms`);
  arena.style.setProperty('--anim-die', `${ANIM.die}ms`);
  arena.style.setProperty('--anim-super', `${ANIM.super}ms`);
  arena.style.setProperty('--anim-skill', `${ANIM.skill}ms`);
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
    if (!sprite || !foeNameEl || !foeHp || !foeHpTxt) return;
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
    if (!sprite || !foeNameEl || !e) return;
    sprite.innerHTML = e.svg;
    // The previous occupant died on this node — clear its death marker, and give
    // the newcomer its own idle rhythm.
    sprite.classList.remove('anim-die', 'anim-hit', 'anim-attack');
    sprite.style.setProperty('--en-bob', `${bobDuration(e.id)}ms`);
    sprite.classList.toggle('mini-boss', e.miniBoss);
    sprite.classList.toggle('world-boss', e.worldBoss);
    // A ghost is a CHARACTER, not a sprite: the class mirrors it so the two
    // fighters face each other instead of both looking the same way.
    sprite.classList.toggle('ghost', e.ghost === true);
    arena?.classList.toggle('boss-fight', e.worldBoss);
    const name = foeName(e);
    foeNameEl.textContent = e.ghost
      ? `⚔️ ${name}`
      : e.worldBoss
        ? `🏛 ${name}`
        : e.miniBoss
          ? `👑 ${name}`
          : name;
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
    if (waveEl) {
      const run = state.challenge;
      // In a gauntlet the counter is "3/10" — a position in the run, not in the
      // world. A duel is a single fight, so it says so instead of "1/1".
      // An overtime wave is labelled as such — "הארכה 3", never a wave the
      // world does not have.
      waveEl.textContent = !run
        ? state.enemy?.overtime
          ? tr(M).arena.overtimeWave(state.overtime + 1)
          : String(state.wave)
        : run.kind === 'ghost'
          ? '⚔️'
          : `${Math.min(run.index + 1, run.waves.length)}/${run.waves.length}`;
    }
  }

  /**
   * The skill bar, repainted from the CORE's view of the skills.
   *
   * Everything here is read from `skillViews()`: the lock state (derived from
   * the part levels, so training opens a slot live), the cooldown as a 0..1
   * fraction — handed to CSS as `--cd` and drawn as a radial sweep — and whether
   * the skill's window is currently up.
   */
  function paintSkills(): void {
    if (skillBtns.size === 0) return;
    const T = tr(M);
    const views = skillViews(state, levels);
    for (const v of views) {
      const btn = skillBtns.get(v.def.id);
      if (!btn) continue;
      const fighting = state.status === 'fighting';
      btn.classList.toggle('locked', !v.unlocked);
      btn.classList.toggle('ready', v.ready && fighting);
      btn.classList.toggle('cooling', v.unlocked && v.cooldownMs > 0);
      btn.classList.toggle('live', v.activeMs > 0);
      btn.style.setProperty('--cd', String(v.unlocked ? v.cooldownRatio : 0));

      const glyph = btn.querySelector('.sk-glyph');
      if (glyph) glyph.textContent = v.unlocked ? v.def.icon : '🔒';
      const sub = btn.querySelector('.sk-sub');
      const hint = partLevel(v.def.part, v.need);
      const subText = !v.unlocked
        ? hint
        : v.cooldownMs > 0
          ? `${Math.ceil(v.cooldownMs / 1000)}s`
          : T.skills.ready;
      if (sub && sub.textContent !== subText) sub.textContent = subText;
      const name = skillName(v.def);
      const label = v.unlocked
        ? T.skills.label(name, skillSummary(v.def, v.power))
        : T.skills.lockedLabel(name, hint);
      if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
    }
    paintBuffs(views);
  }

  /**
   * The live buffs as small chips over the hero — one per running window, with
   * the seconds left. Rewritten only when the text actually changes, so the
   * loop is not rebuilding DOM sixty times a second.
   */
  let buffSig = '';
  function paintBuffs(views: readonly SkillView[]): void {
    if (!buffsEl) return;
    const live = views.filter((v) => v.activeMs > 0);
    const sig = live.map((v) => `${v.def.id}:${Math.ceil(v.activeMs / 1000)}`).join('|');
    if (sig === buffSig) return;
    buffSig = sig;
    buffsEl.innerHTML = live
      .map(
        (v) =>
          `<span class="bt-chip sk-${v.def.id}" title="${esc(skillName(v.def))}">${v.def.icon}${
            // מכה מדויקת waits for the next swing rather than for a clock.
            v.def.id === 'focus' ? '' : ` ${Math.ceil(v.activeMs / 1000)}`
          }</span>`,
      )
      .join('');
  }

  /** The screen's reaction to a skill: a tinted flash over the arena. */
  function skillFlash(skillId: SkillId): void {
    if (!fx) return;
    anim(fx, `fx-${skillId}`, ANIM.skill);
  }

  function paintStatus(): void {
    if (!statusEl) return;
    let text = '';
    let cls = '';
    const T = tr(M).status;
    // A challenge run speaks for itself — it has no energy, no gate and no
    // knock-out recovery, so none of the campaign's lines apply to it.
    const run = state.challenge;
    if (run && run.kind === 'ghost') {
      const name = run.opponent?.name ?? '';
      if (state.status === 'finished') {
        // A duel's purse is decided by how it ended, and the status line is the
        // first place the player reads it — the toast and the feed say the same
        // number because all three ask `duelCoins`.
        const won = run.cleared > 0;
        text = won ? T.duelWon(name, duelCoins(true)) : T.duelLost(name, duelCoins(false));
      } else {
        text = T.duelLive(name);
      }
      statusEl.textContent = text;
      statusEl.className = 'bt-status duel';
      return;
    }
    if (run) {
      const total = run.waves.length;
      if (state.status === 'finished') {
        text = run.cleared >= total ? T.dailyFull(run.cleared, total) : T.dailyOver(run.cleared, total);
      } else {
        text = T.dailyLive(Math.min(run.index + 1, total), total);
      }
      statusEl.textContent = text;
      statusEl.className = 'bt-status daily';
      return;
    }
    // At the boss wave without a boss on screen the campaign is in OVERTIME
    // (paid waves past the end, the boss fee kept in reserve) or, when the
    // purse cannot afford one, SPARRING: reward-less fights while the boss
    // waits to be called.
    const overtime = state.enemy?.overtime === true;
    const sparring =
      !overtime &&
      state.enemy?.worldBoss !== true &&
      bossStanding(state.world, state.wave, state.defeatedBosses);
    switch (state.status) {
      case 'resting':
        text = T.resting(BALANCE.energy.perSet, BALANCE.energy.perWorkout);
        cls = 'rest';
        break;
      case 'recovering':
        text = T.recovering(state.wave);
        cls = 'down';
        break;
      default:
        if (state.enemy?.worldBoss) {
          text = T.boss(foeName(state.enemy));
          cls = 'boss';
        } else if (overtime) {
          const k = state.overtime + 1;
          const gate = worldGate(state.world, partLevels(gameOf(store)));
          const missing = gate.requirements
            .filter((r) => !r.met)
            .map((r) => partLevel(r.part, r.need))
            .join(' · ');
          text = state.gateOpen
            ? T.overtimeOpen(k, BALANCE.combat.energyPerWave, BALANCE.combat.boss.energyCost)
            : T.overtimeGated(k, missing || T.training, BALANCE.combat.energyPerWave);
          cls = 'gate';
        } else if (sparring && !state.gateOpen) {
          const gate = worldGate(state.world, partLevels(gameOf(store)));
          const missing = gate.requirements
            .filter((r) => !r.met)
            .map((r) => partLevel(r.part, r.need))
            .join(' · ');
          text = T.sparringGated(handicapPct(gate.deficit), missing || T.training);
          cls = 'gate';
        } else if (sparring) {
          text = T.sparringOpen;
          cls = 'gate';
        } else {
          text =
            state.streakDefeats >= BALANCE.combat.defeatsBeforeHint
              ? T.tooStrong
              : T.tap;
          cls = state.streakDefeats >= BALANCE.combat.defeatsBeforeHint ? 'warn' : '';
        }
    }
    statusEl.textContent = text;
    statusEl.className = `bt-status ${cls}`;
  }

  /**
   * The boss button — present the whole time the player stands at the boss
   * wave (the sparring stretch), so the arena SAYS why these bouts pay
   * nothing: the boss is the way forward. It is ALWAYS pressable there: while
   * the body-part gate is unmet it renders as the EARLY challenge — amber, with
   * the handicap the boss will carry — and turns into the plain boss button the
   * moment the gate is met. It only disappears once the fight itself is on.
   */
  function paintBossBtn(): void {
    if (!bossBtn) return;
    const show =
      !state.challenge &&
      !state.bossRequested &&
      bossStanding(state.world, state.wave, state.defeatedBosses);
    bossBtn.hidden = !show;
    if (!show) return;
    const spec = bossSpec(state.world, state.gateDeficit);
    const boss = worldBossOf(state.world);
    const early = !state.gateOpen;
    bossBtn.disabled = false;
    bossBtn.classList.toggle('early', early);
    const T = tr(M).bossBtn;
    const name = boss ? foeName(boss) : null;
    const cost = spec ? spec.energyCost : null;
    const label = early ? T.early(name, handicapPct(state.gateDeficit), cost) : T.ready(name, cost);
    if (bossBtn.textContent !== label) bossBtn.textContent = label;
  }

  function paintTotals(): void {
    const g = gameOf(store);
    if (coinsEl) coinsEl.textContent = fmtXp(g.battle.coins);
    if (clearedEl) clearedEl.textContent = String(g.battle.wavesCleared);
    if (minisEl) minisEl.textContent = String(g.battle.miniBossesCleared);
    if (bossesEl) bossesEl.textContent = String(g.battle.bossesDefeated.length);
  }

  /* ----------------------------------------------------- daily challenge */

  /**
   * Today, resolved ONCE when the arena mounts. Every screen change re-mounts
   * this module, so the card cannot go stale for long — and a run that started
   * before midnight stays the run of the challenge it is actually playing.
   */
  const today = todayISO();
  const card = main.querySelector<HTMLElement>('.bt-card');

  /** Repaint the card from the store + the live run, and re-wire its button. */
  function paintDaily(): void {
    if (!dailyEl) return;
    // Only a DAILY run belongs to this card: a duel is somebody else's fight,
    // and passing it here would light the gauntlet's "live" state by mistake.
    const run = state.challenge;
    dailyEl.innerHTML = dailyCard(gameOf(store), today, run && run.kind === 'daily' ? run : null);
    dailyEl
      .querySelector<HTMLButtonElement>('#btDailyGo')
      ?.addEventListener('click', startDaily);
  }

  /**
   * Frame the arena for the context on screen: amber for the daily gauntlet,
   * violet for a duel, nothing for the campaign. The two are separate classes so
   * a test (and a reader) can tell which fight this is at a glance.
   */
  function setChallengeSkin(kind: 'daily' | 'ghost' | null): void {
    arena?.classList.toggle('challenge', kind === 'daily');
    card?.classList.toggle('challenge', kind === 'daily');
    arena?.classList.toggle('duel', kind === 'ghost');
    card?.classList.toggle('duel', kind === 'ghost');
    if (heroName) heroName.textContent = kind === 'ghost' ? tr(M).arena.you : '';
  }

  /**
   * Enter today's challenge.
   *
   * The gate is asked BEFORE anything is created (`dailyStatus`), so a refused
   * attempt — already played, or not enough ⚡ — writes nothing at all and only
   * explains itself in Hebrew.
   */
  function startDaily(): void {
    if (state.challenge) {
      if (state.challenge.kind === 'ghost') toast(tr(M).toast.finishDuel);
      return;
    }
    const status = dailyStatus(store, today);
    if (!status.ok) {
      const waves = BALANCE.daily.waves;
      toast(
        status.error === 'already_played'
          ? tr(M).toast.dailyUsed(status.record?.score ?? 0, waves)
          : tr(M).toast.dailyNoEnergy(status.energyCost),
      );
      paintDaily();
      return;
    }
    const g = gameOf(store);
    stats = statsOf(g);
    levels = partLevels(g);
    // The SAME state machine, a different context: no second loop, no second
    // renderer, and `wave_cleared` is not emitted while this is on screen.
    state = createChallengeBattle({ run: dailyRun(today), stats, energy: g.energy });
    setChallengeSkin('daily');
    buffSig = '';
    toast(tr(M).toast.dailyStart(BALANCE.daily.waves));
    paintDaily();
    consume(advance(state, BALANCE.combat.tickMs, stats));
  }

  /** Persist a finished run (however it ended) and tell the player how it went. */
  function endDaily(result: ChallengeResult): void {
    const save = onDailyChallenge(store, result);
    setEnergy(state, gameOf(store).energy);
    paintTotals();
    deps.refreshHeader();
    paintDaily();
    if (save.duplicate) {
      toast(tr(M).toast.dailyDuplicate);
    } else {
      toast(tr(M).toast.dailyResult(result.score, BALANCE.daily.waves, result.coins, result.complete === true));
    }
    // Let the result sit for a beat, then hand the arena back to the campaign.
    setTimeout(() => {
      if (!disposed) restoreCampaign();
    }, 2200);
  }

  /** Back to the ordinary world/wave battle, exactly as the screen mounted it. */
  function restoreCampaign(): void {
    const g = gameOf(store);
    stats = statsOf(g);
    levels = partLevels(g);
    state = createBattle({
      seed: sessionSeed(),
      world: g.battle.world,
      wave: g.battle.wave,
      energy: g.energy,
      stats,
      gateOpen: !gateFor(g).locked,
      gateDeficit: gateFor(g).deficit,
      overtime: g.battle.overtime[String(g.battle.world)] ?? 0,
      defeatedBosses: g.battle.bossesDefeated,
    });
    setChallengeSkin(null);
    if (arena) {
      const world = worldById(g.battle.world);
      arena.style.setProperty('--w-accent', world.accent);
      arena.style.setProperty('--w-bg1', world.bg[0]);
      arena.style.setProperty('--w-bg2', world.bg[1]);
    }
    buffSig = '';
    paintDaily();
    paintGhost();
    consume(advance(state, BALANCE.combat.tickMs, stats));
  }

  /* ---------------------------------------------------------- ghost duel */

  /**
   * The duel card's own little state: who is in the input, who was looked up,
   * and what went wrong. It is UI state, deliberately not persisted — a lookup
   * is a question, not a fact about the account.
   */
  let ghostView: GhostCardView = emptyGhostView(deps.ghost?.myHandle() ?? '', deps.ghost?.recent() ?? []);
  /** The payload actually being fought — its hash goes into the record. */
  let duelGhost: GhostPayload | null = null;

  /** Repaint the duel card from the store + the live run, and re-wire it. */
  function paintGhost(): void {
    if (!ghostEl) return;
    // No account, no duel: the card is ABSENT, not disabled (same rule as the
    // account card — see `sync/account.ts`).
    if (!deps.ghost || !deps.ghost.signedIn()) {
      ghostEl.innerHTML = '';
      return;
    }
    const run = state.challenge;
    ghostView = {
      ...ghostView,
      myHandle: deps.ghost.myHandle(),
      recent: deps.ghost.recent(),
      live: run !== null && run.kind === 'ghost' && run.outcome === 'running',
    };
    ghostEl.innerHTML = ghostCard(
      gameOf(store),
      ghostView,
      today,
      run && run.kind === 'ghost' ? { cleared: run.cleared } : null,
    );
    const input = ghostEl.querySelector<HTMLInputElement>('#gdHandle');
    input?.addEventListener('input', () => {
      // Typing invalidates the opponent on the card: the preview must never
      // describe somebody other than the name in the field.
      ghostView = { ...ghostView, query: input.value, opponent: null, error: '' };
    });
    input?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void findOpponent(input.value);
    });
    ghostEl.querySelector<HTMLButtonElement>('#gdFind')?.addEventListener('click', () => {
      void findOpponent(input?.value ?? ghostView.query);
    });
    ghostEl.querySelector<HTMLButtonElement>('#gdFight')?.addEventListener('click', startDuel);
  }

  /**
   * Look an opponent up.
   *
   * Everything a hostile or broken row could do stops here: the handle is
   * validated before the request, and the answer goes through `normalizeGhost`,
   * which either returns a payload inside every legal bound or `null`. Nothing
   * else in the arena ever sees the raw row.
   */
  async function findOpponent(raw: string): Promise<void> {
    const port = deps.ghost;
    if (!port) return;
    const check = checkHandle(raw);
    if (!check.ok) {
      ghostView = { ...ghostView, query: raw, opponent: null, error: tr(M).handleError[check.error ?? 'empty'] };
      paintGhost();
      return;
    }
    if (check.handle === port.myHandle()) {
      ghostView = { ...ghostView, query: raw, opponent: null, error: tr(M).handleError.self };
      paintGhost();
      return;
    }
    ghostView = { ...ghostView, query: check.handle, opponent: null, error: '', searching: true };
    paintGhost();

    let row: { handle: string; payload: Record<string, unknown> } | null = null;
    try {
      row = await port.fetch(check.handle);
    } catch {
      if (disposed) return;
      ghostView = { ...ghostView, searching: false, error: tr(GM).lookupFailed };
      paintGhost();
      return;
    }
    if (disposed) return;
    const ghost = row ? normalizeGhost(row.payload) : null;
    if (!row) {
      ghostView = { ...ghostView, searching: false, error: tr(GM).missing(check.handle) };
    } else if (!ghost) {
      ghostView = { ...ghostView, searching: false, error: tr(GM).badPayload };
    } else {
      ghostView = {
        ...ghostView,
        searching: false,
        error: '',
        opponent: { handle: check.handle, ghost },
      };
      port.remember(check.handle);
    }
    paintGhost();
  }

  /**
   * Enter the duel.
   *
   * The gate is asked BEFORE anything is created (`ghostDuelStatus`), so a
   * refused duel — already fought today, or not enough ⚡ — writes nothing at all
   * and only explains itself in Hebrew. The opponent's SVG is built here, in the
   * UI, and handed to the run: `core/ghost.ts` owns the numbers, this file owns
   * the drawing.
   */
  function startDuel(): void {
    const port = deps.ghost;
    const opponent = ghostView.opponent;
    if (!port || !opponent) return;
    // One fight at a time: the arena holds exactly one challenge context.
    if (state.challenge) {
      toast(tr(M).toast.finishDaily);
      return;
    }
    const myHandle = port.myHandle();
    if (!myHandle) {
      toast(tr(GM).noHandle);
      return;
    }
    const status = ghostDuelStatus(store, today, opponent.handle);
    if (!status.ok) {
      toast(
        status.error === 'already_dueled'
          ? tr(M).toast.alreadyDueled(opponent.ghost.name, status.record?.won === true)
          : tr(M).toast.duelNoEnergy(status.energyCost),
      );
      paintGhost();
      return;
    }
    const g = gameOf(store);
    stats = statsOf(g);
    levels = partLevels(g);
    duelGhost = opponent.ghost;
    state = createChallengeBattle({
      run: ghostRun({
        myHandle,
        opponentHandle: opponent.handle,
        ghost: opponent.ghost,
        date: today,
        svg: ghostFigure(opponent.ghost),
      }),
      stats,
      energy: g.energy,
    });
    setChallengeSkin('ghost');
    buffSig = '';
    toast(tr(M).toast.duelStart(opponent.ghost.name));
    paintGhost();
    consume(advance(state, BALANCE.combat.tickMs, stats));
  }

  /**
   * Persist a finished duel (however it ended) — ONE write, and the only one the
   * feature makes. The coins ride in the event and are paid by the reducer, so a
   * duplicate pays nothing a second time.
   */
  function saveDuel(result: ChallengeResult): { duplicate: boolean } {
    const hash = duelGhost ? ghostHash(duelGhost) : '';
    return onGhostDuel(store, result, hash);
  }

  /** The duel is over: record it, say how it went, hand the arena back. */
  function endDuel(result: ChallengeResult): void {
    const save = saveDuel(result);
    setEnergy(state, gameOf(store).energy);
    paintTotals();
    deps.refreshHeader();
    paintGhost();
    const name = result.opponent?.name ?? '';
    if (save.duplicate) {
      toast(tr(M).toast.duelDuplicate);
    } else {
      const coins = duelCoins(result.won === true);
      toast(result.won ? tr(M).toast.duelWon(name, coins) : tr(M).toast.duelLost(name, coins));
      // The purse moved — show it landing, exactly like a cleared wave does.
      if (coins > 0) float(`+${coins} 🪙`, 'coin', 'hero');
    }
    setTimeout(() => {
      if (!disposed) restoreCampaign();
    }, 2200);
  }

  /**
   * Give up a run that is still on screen — called when the arena goes away.
   *
   * The attempt is spent either way, and which EVENT it becomes follows the run
   * itself: a daily gauntlet pays for the waves it cleared, a duel is recorded
   * as a loss (leaving a fight is not a draw). Neither can be written twice —
   * both builders refuse once their ledger slot is taken.
   */
  function commitForfeit(): void {
    const run = state.challenge;
    if (!run || run.outcome !== 'running') return;
    const result = forfeitChallenge(state);
    if (!result) return;
    if (result.kind === 'ghost') saveDuel(result);
    else onDailyChallenge(store, result);
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
          toast(tr(M).toast.bossSpawn(foeName(ev.spec.boss)));
          break;
        case 'hit':
          paintEnemy();
          float(
            `${ev.crit ? '💥' : ''}${fmtXp(ev.amount)}`,
            ev.source === 'super' || ev.source === 'skill' ? 'super' : ev.crit ? 'crit' : 'dmg',
            'enemy',
          );
          // The lunge is per ATTACK EVENT, which is what keeps it in step with a
          // Shoulders-driven attack interval that changes as the player trains —
          // there is no separate animation clock to drift. A super or a skill
          // brings its own pose, so it does not get the ordinary one.
          if (ev.source !== 'super' && ev.source !== 'skill') {
            anim(heroSprite, 'anim-attack', ANIM.attack);
          }
          anim(sprite, 'anim-hit', ANIM.hit);
          if (ev.source === 'super') shake(true);
          break;
        case 'dodged':
          // ממלכת הצללים — the blow found nothing. It must be VISIBLE or a shade
          // just looks like a bug; the hero still lunges, because they did swing.
          float(tr(M).arena.miss, 'miss', 'enemy');
          if (ev.source !== 'super' && ev.source !== 'skill') {
            anim(heroSprite, 'anim-attack', ANIM.attack);
          }
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
        case 'enemy_regen':
          // Only a ghost ever heals — its owner trained a Core, and the number
          // has to be visible or the fight looks broken.
          paintEnemy();
          if (ev.amount > 0) float(`+${fmtXp(ev.amount)}`, 'heal', 'enemy');
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
          syncGate(g, g.battle.bossesDefeated);
          paintTotals();
          deps.refreshHeader();
          shake(true);
          float(`+${ev.result.coins} 🪙`, 'coin', 'enemy');
          arena?.classList.remove('boss-fight');
          sprite?.classList.remove('world-boss');
          toast(
            ev.result.endgame ? tr(M).toast.endgame : tr(M).toast.bossDown(ev.result.nextWorld),
          );
          // The whole screen changes (new world, new gate card) — remount it.
          queueRemount();
          break;
        }
        case 'challenge_spawn': {
          spawnSprite();
          // The gauntlet tours the worlds — the backdrop travels with it.
          const world = worldById(ev.wave.world);
          arena?.style.setProperty('--w-accent', world.accent);
          arena?.style.setProperty('--w-bg1', world.bg[0]);
          arena?.style.setProperty('--w-bg2', world.bg[1]);
          if (ev.wave.miniBoss) shake(true);
          paintDaily();
          paintGhost();
          break;
        }
        case 'challenge_wave':
          anim(sprite, 'anim-die', ANIM.die);
          // NOTHING is persisted per wave: the coins are banked in the run and
          // paid by the single event written when the run ends.
          // A duel wave carries no coins of its own (the whole purse depends on
          // how the single fight ended), so there is nothing to float for one —
          // `endDuel` floats the payout instead.
          if (ev.wave.coins > 0) float(`+${ev.wave.coins} 🪙`, 'coin', 'enemy');
          paintDaily();
          paintGhost();
          break;
        case 'challenge_over':
          anim(heroSprite, ev.result.complete ? 'anim-victory' : 'anim-hurt', ANIM.victory);
          if (ev.result.kind === 'ghost') endDuel(ev.result);
          else endDaily(ev.result);
          break;
        case 'defeat':
          paintHero();
          anim(heroSprite, 'anim-hurt', ANIM.hit);
          shake(true);
          break;
        case 'skill_used': {
          // The pose and the flash go on BEFORE the damage numbers are drawn, so
          // the hit lands on top of the wind-up instead of a beat after it. The
          // TRAINED PART flexes too — `sk-<part>` is what anim.css hangs that on.
          anim(heroSprite, 'anim-skill', ANIM.skill);
          anim(heroSprite, `sk-${ev.part}`, ANIM.skill);
          skillFlash(ev.skillId);
          // The two heavy blows shove the screen; the rest only tint it.
          shake(ev.skillId === 'smash' || ev.skillId === 'quake');
          const def = SKILLS.find((s) => s.id === ev.skillId);
          if (def) float(`${def.icon} ${skillName(def)}`, 'skill', 'hero');
          break;
        }
        case 'sparring_cleared':
          // A sparring partner fell — the collapse plays, but nothing is
          // persisted and no coins float: the bout was worth exactly nothing.
          anim(sprite, 'anim-die', ANIM.die);
          break;
        case 'skill_expired':
        case 'super_ready':
        case 'resting':
          break;
      }
    }
    paintHero();
    paintMeters();
    paintSkills();
    paintStatus();
    paintBossBtn();
  }

  /* ----------------------------------------------------------- the loop */

  function frame(now: number): void {
    if (disposed || !running) return;
    const dt = last === 0 ? 0 : now - last;
    last = now;
    // Level-ups can happen while the tab is open (another device, an import) —
    // re-derive the stats every frame; it is a handful of multiplications. The
    // boss gate rides along, so hitting the required level while the arena is on
    // screen makes the boss button light up without a reload.
    const g = gameOf(store);
    stats = statsOf(g);
    // Same story for the skills: they unlock off the part levels, so a level-up
    // while the arena is open lights the slot up without a reload.
    levels = partLevels(g);
    if (!state.challenge) syncGate(g);
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

  /**
   * A skill slot. The CORE decides — this only explains the refusal in Hebrew,
   * which is the whole reason a locked slot is a live button and not a disabled
   * one: "🔒" alone teaches nothing, "חזה רמה 5" teaches exactly what to train.
   */
  for (const [id, btn] of skillBtns) {
    btn.addEventListener('click', () => {
      const g = gameOf(store);
      stats = statsOf(g);
      levels = partLevels(g);
      const def = SKILLS.find((s) => s.id === id);
      const res = useSkill(state, id, stats, levels);
      if (res.accepted) {
        consume(res.events);
        return;
      }
      if (!def) return;
      const view = skillViews(state, levels).find((v) => v.def.id === id);
      const T = tr(M).toast;
      const name = skillName(def);
      if (res.reason === 'locked') {
        toast(T.skillLocked(name, bodyPartName(def.part), skillUnlockLevel(), view?.have ?? 1, skillDesc(def)));
      } else if (res.reason === 'cooldown') {
        toast(T.skillCooldown(name, Math.ceil((view?.cooldownMs ?? 0) / 1000)));
      } else {
        toast(T.skillNoEnemy(def.icon, name));
      }
      paintSkills();
    });
  }

  /**
   * The boss button. The CORE decides (`requestBossFight` re-checks the gate,
   * the wave and the energy) — this only starts the tick that spawns the boss,
   * or explains the refusal in Hebrew. The button is only ever VISIBLE when the
   * gate is met, but the state can move under it (energy spent in another tab),
   * so the refusal paths still matter.
   */
  bossBtn?.addEventListener('click', () => {
    const g = gameOf(store);
    stats = statsOf(g);
    levels = partLevels(g);
    syncGate(g, g.battle.bossesDefeated);
    const res = requestBossFight(state);
    if (!res.ok) {
      const spec = bossSpec(state.world, state.gateDeficit);
      if (res.reason === 'no_energy') {
        toast(tr(M).toast.bossNoEnergy(spec?.energyCost ?? 0, fmtXp(state.energy)));
      }
      paintBossBtn();
      return;
    }
    if (!state.gateOpen) {
      toast(tr(M).toast.earlyFight(handicapPct(state.gateDeficit)));
    }
    // The next tick spawns the boss — run it now so the fight starts under the
    // player's finger rather than a frame later.
    consume(advance(state, BALANCE.combat.tickMs, stats));
  });

  // The gate coaching's shortcut into the plan editor (rendered only when the
  // shell handed us a way there).
  main.querySelector<HTMLButtonElement>('#btCoachPlan')?.addEventListener('click', () => {
    deps.editPlan?.();
  });

  superBtn?.addEventListener('click', () => {
    stats = statsOf(gameOf(store));
    const res = useSuper(state, stats);
    // The wind-up pose goes on BEFORE the events are drawn, so the pop and the
    // damage number land together rather than the hero reacting a beat late.
    if (res.accepted) anim(heroSprite, 'anim-super', ANIM.super);
    consume(res.events);
  });

  // The dev panel's cooldown reset, live only while this arena is mounted.
  cooldownReset = (): void => {
    for (const id of SKILL_IDS) state.skills.cd[id] = 0;
    paintSkills();
  };

  active = {
    stop: () => {
      // Leaving the arena FORFEITS a run that is still going — recorded here,
      // once, with exactly the waves that were cleared.
      commitForfeit();
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
  paintDaily();
  paintGhost();
  paintHero();
  paintMeters();
  paintSkills();
  paintStatus();
  paintBossBtn();
  resume();
}
