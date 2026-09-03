# Progression pacing plan — closing the gap between "out of waves" and "boss opens"

Status: **implemented** (all four phases, on this branch). Written from measurements
against the real engine (`onSetCompleted` → levels, `createBattle`/`advance` → fights),
not estimates. The simulation described in §6 is now `tests/helpers/trainee.ts`, and
`tests/pacing.test.ts` pins the numbers.

## 0. What shipped (and how it differs from the plan below)

After the plan was written the retune was widened from "lower the gates" to "meet in
the middle": worlds got LONGER and STEEPER as well, so the waves' own ramp is what
sends the player to train and the gate opens when the waves run out.

| World | Waves | Span (classic steps) | Gate | Waves run out → gate opens (builtin / ab4) | Boss at the boss (ab4) |
|---|---|---|---|---|---|
| 1 | 50 | 49 | chest 3 · arms 3 · legs 3 | 3→4 / 2→4 | 26 s |
| 2 | 80 | 49 | chest 3 · back 4 · arms 4 | 6→6 / 5→4 | 38 s |
| 3 | 110 | 50 | back 5 · legs 5 · shoulders 4 · core 4 | 11→10 / 8→6 | 47 s |
| 4 | 130 | 54 | chest 5 · back 6 · legs 6 · shoulders 5 · arms 6 · core 6 | 17→15 / 12→12 | 60 s |
| 5 | 140 | 59 | chest 6 · back 7 · legs 7 · shoulders 6 · arms 7 · core 6 | 24→21 / 16→16 | 60 s |
| 6 | 150 | 64 | chest 6 · back 8 · legs 8 · shoulders 7 · arms 8 · core 7 | 30→30 / 21→19 | 55 s |
| 7 | 160 | 65 | chest 7 · back 9 · legs 8 · shoulders 8 · arms 9 · core 8 | 38→36 / 26→25 | 59 s |
| 8 | 170 | 59 | chest 7 · back 9 · legs 9 · shoulders 8 · arms 9 · core 8 | 45→42 / 31→26 | 57 s |
| 9 | 180 | 66 | chest 8 · back 10 · legs 9 · shoulders 9 · arms 10 · core 9 | 53→50 / 37→35 | 63 s |

- **Phase 1** — as above. 1,170 waves ≈ 53 workouts of ⚡ on the built-in split (≈37 on
  the A/B 4-day preset). The five late boss `hpMult` came down (3.8 / 3.9 / 3.7 / 3.4 /
  2.95) because their ramps went up; worlds 1–4 keep theirs. Coins do not follow the
  span (`coinStretch`), and the late coin step eased 1.2 → 1.12 so the longer campaign
  still buys the shop under six times (≈252,500 🪙 against 47,250).
- **Phase 2** — the early challenge: +12 % HP and +5 % damage per missing level, capped
  at twelve. One level short on every required part is a 110–135 s fight from world 4
  on; three short is a loss (or ≥2.5× the fight). In worlds 1–3 one level short is a
  wall with or without the handicap — a level is a fifth of the character there.
- **Phase 3** — overtime waves, with the boss fee kept in reserve (overtime spawns only
  while the purse holds a wave plus the fee); below that, free sparring as before.
- **Phase 4** — the coaching block on the gate card, plus a shortcut into the plan
  editor. Each row: `part have→need · N sets/week in the plan · ~K workouts · add: …`.

The original plan follows, unchanged, as the record of why.

## 1. The symptom, measured

The report: "my character clears every wave of world 3 but the world boss is gated,
and the next world will be the same." That is exactly what the engine does today.

The journey has two independent pacers ("two poles", README §📐):

- **Energy pole** — waves cost ⚡ and only training pays ⚡. A world's waves run out
  after a fixed amount of training (world 3: cumulative ≈8.4 workouts).
- **Gate pole** — the boss button needs body-part levels. Levels come from XP, which
  the same training pays.

They were meant to coincide ("the gate opens about one workout after the waves run
out"). They don't. Simulating a trainee through the real grant path, logging every
set with progressive loading, on the two shipped plans:

| World | Waves run out (workout #) builtin 3×/wk | Gate opens builtin | **Wait** | Waves run out ab4 4×/wk | Gate opens ab4 | **Wait** |
|---|---|---|---|---|---|---|
| 1 | 3 | 4 | 1 | 2 | 4 | 2 |
| 2 | 6 | 9 | 3 | 4 | 11 | 7 |
| 3 | 9 | 18 | **9** | 6 | 18 | **12** |
| 4 | 12 | 36 | **24** | 9 | 33 | **24** |
| 5 | 16 | 36 | 20 | 11 | 46 | **35** |
| 6 | 20 | 36 | 16 | 14 | 46 | 32 |
| 7 | 25 | 42 | 17 | 17 | 63 | **46** |
| 8 | 29 | 49 | 20 | 20 | 63 | 43 |
| 9 | 34 | 50 | 16 | 24 | 63 | 39 |

("ab4" is the A/B 4-day preset in `src/data/presets.ts`, the owner's own split.)

From world 3 on, the player spends **more workouts waiting at a locked boss than
playing**: 9–12 workouts (3–4 weeks) at world 3, 24 workouts (2 months) at world 4,
and on the ab4 split the late gates open 40+ workouts after the waves are gone. Over
the whole campaign roughly two thirds of arena time is reward-less sparring.

And the wall is *only* the gate. At the moment world 3's energy runs out (workout 9
builtin / 6 ab4), the character in tier-1 +1 gear, using skills, taps and supers:

| | last 6 waves of world 3 | boss of world 3 (if the gate were open) |
|---|---|---|
| builtin, workout 9 | 6/6 cleared, 0 defeats, 39 s | killed, 34 s, 0 defeats |
| ab4, workout 6 | 6/6 cleared, 0 defeats, 63 s | killed, 51 s, 0 defeats |

The gate at that moment still wants back 7 / core 7 / legs 6 / shoulders 6 against
back 5 / core 5 / legs 4 / shoulders 4. The fight is already won; the door is shut.

## 2. Why it drifted

1. **The gate was tuned to a combat curve that no longer exists.** The gate levels
   (3/5/7/8/9/9/10/10/10) were set to "the level at which the last wave of world N
   is clearable". Since then the player got six body-part skills at level 5, six
   equipment slots, +3 upgrades and the streak buff, and combat got much easier —
   the last waves of world 3 clear at level 4–5, not 7. The gate never moved.
2. **The gate is a per-part minimum, so the weakest part of *your plan* sets the
   pace.** Per 3-day cycle the built-in split gives shoulders 2.4 set-equivalents
   (chest 14.3); the ab4 split gives chest 2.4 (back 30.1). World 4+ asks all six
   parts, so a pull-heavy trainee is paced by chest, which they barely train. The
   50-XP completion bonus is the only equalizer and it is small next to level 8's
   cumulative cost (≈2,950 XP per part).
3. **Nothing caps or spends the bank.** Sparring is free and energy has no ceiling,
   so ⚡ piles up while gated (≈2,000 ⚡ banked at the world-3 gate = 200 waves =
   world 4 and half of 5 in one sitting), and the player then lands straight in the
   next, longer wait. The rhythm is months of nothing, one binge, months of nothing.
4. **The wait pays nothing.** Sparring writes no coins, so the time at the gate
   doesn't even buy gear.

## 3. Target

- **The boss opens within ±2 workouts of the waves running out, on any reasonable
  plan** (both shipped presets), pinned by a simulation test.
- **Energy stays the floor.** The 34-workout energy pole is untouched — the golden
  rule ("no progress without real training") is enforced by ⚡, not by the gate.
- Every boss is a **30–75 s active fight at its gate in era gear, ≤1 defeat**
  (the band `tests/boss.test.ts` already pins).
- Historical `wave_cleared` / `boss_defeated` payloads stay authoritative; nothing
  re-derives the past.

## 4. The plan, in shippable phases

### Phase 1 — Re-anchor the gates to the energy pole (content only, ship first)

Lower every gate from world 2 on so it opens when the waves run out. Measured
candidate (each boss fought at exactly its gate, untrained parts one level below,
era gear per the existing `ERA_GEAR` ladder, skills + taps + supers):

| World | Current `requires` | **Proposed** | Sum | Opens builtin / ab4 | Waves run out builtin / ab4 | Boss at gate (current `hpMult`) |
|---|---|---|---|---|---|---|
| 1 | chest 3 · arms 3 · legs 3 | unchanged | 9 | 4 / 4 | 3 / 2 | 54 s |
| 2 | chest 5 · back 5 · arms 5 | chest 4 · back 4 · arms 4 | 12 | 6 / 7 | 6 / 4 | 33 s |
| 3 | back 7 · core 7 · legs 6 · shoulders 6 | back 5 · core 5 · legs 5 · shoulders 5 | 20 | 12 / 9 | 9 / 6 | 47 s |
| 4 | all six 8 | all six 5 | 30 | 12 / 11 | 12 / 9 | 49 s |
| 5 | 9·8·8·8·9·8 | chest 6 · back 6 · arms 6 · legs 5 · shoulders 5 · core 5 | 33 | 13 / 16 | 16 / 11 | 56 s |
| 6 | 9·9·8·8·9·9 | all six 6 | 36 | 18 / 16 | 20 / 14 | 55 s |
| 7 | 10·9·9·8·9·9 | chest 7 · back 7 · arms 7 · legs 6 · shoulders 6 · core 6 | 39 | 18 / 23 | 25 / 17 | 57 s |
| 8 | 10·9·9·9·10·10 | all six 7 | 42 | 25 / 23 | 29 / 20 | 51 s |
| 9 | 10·10·9·9·10·10 | chest 8 · back 8 · arms 8 · core 8 · legs 7 · shoulders 7 | 46 | 26 / 33 | 34 / 24 | 49 s |

(Order of `requires` keys above is chest · back · legs · shoulders · arms · core.)

Every boss stays inside the 30–75 s band with **no `hpMult` change** and zero
defeats; the last six waves of every world clear at 7–15 s per wave with zero
defeats. The requirement sum still rises strictly world over world. The ab4 split
still lags by 3–9 workouts at worlds 5, 7 and 9 because of its chest deficit —
Phase 4 addresses that; Phase 2 makes it a nuisance rather than a wall.

Work:
- `src/data/gameContent.ts` — `WORLD_BOSSES[].requires` per the table; rewrite the
  "GATE TUNING" comment (the 3/5/7/8/9/9/10/10/10 story is no longer true).
- `tests/boss.test.ts` — the `expected` map in "is reachable by a consistent
  trainee" becomes `{1:3, 2:4, 3:5, 4:5, 5:6, 6:6, 7:7, 8:7, 9:8}`; the `gateStats`
  helper needs no change.
- `tests/worlds.test.ts` — the `band` array becomes `[3,4,5,5,6,6,7,7,8]` and the
  `era` levels in "clears each world's LAST waves" follow it.
- **New pinned test** `tests/pacing.test.ts` — the two-pole simulation from §6:
  for both presets, `gateOpens(world) − wavesRunOut(world)` must be within
  `[-3, +3]` for every world. This is the test that would have caught the drift.
- README §📐 table: the "השער נפתח (אימון)" column and the "שער" column; the
  "איך המספרים נבחרו" paragraph.
- No engine change, no `GAME_STATE_VERSION` bump: `worldGate` is derived from live
  levels on every render, so existing accounts are re-evaluated immediately. The
  reporter's world-3 gate (back 5 · core 5 · legs 5 · shoulders 5) should open on
  the first launch of the new build.

### Phase 2 — Make the wall a door: early challenge with a handicap (engine + UI)

Keep the requirements (the brief wants them shown, and they direct training) but
stop them from being a hard lock. Once the waves are gone the boss button is
always pressable; below the gate the boss is **strengthened**, scaled by how far
below the player is:

```
deficit  = Σ over required parts of max(0, need − have)
bossHp   = spec.hp  × (1 + handicap.hpPerLevel  × min(deficit, handicap.maxLevels))
bossAtk  = spec.atk × (1 + handicap.atkPerLevel × min(deficit, handicap.maxLevels))
```

Starting numbers to tune by simulation in `BALANCE.combat.boss.handicap`:
`hpPerLevel 0.2`, `atkPerLevel 0.08`, `maxLevels 8`. Intent: one level short on
each of four parts (+80 % HP) is a long, tense, winnable fight (90–150 s, maybe one
knock-out); four levels short is a loss, so training still matters. Reward and
energy cost unchanged — the handicap *is* the price.

Work:
- `core/combat.ts` — `bossSpec(world, levels?)` returns the handicapped numbers and
  the `deficit`; `requestBossFight` no longer refuses `gate_locked` (energy and
  "at the boss wave" still refuse); `worldGate` stays as the *recommendation*.
- `storage/DataStore.ts` — `BossDefeatedPayload` gains `deficit: number` (additive;
  old events read as 0). Replay never recomputes it, so no version bump.
- `ui/battle.ts` — gate card copy: "רמות מומלצות" with met/unmet as today, plus a
  line "הבוס מחוזק ב־80 % כי חסר: רגליים 5 · ליבה 5"; the boss button reads
  "🏛 קרב בוס (מחוזק)" below the gate and is styled `warn`.
- Tests: fight at gate−1 on every required part is winnable in era gear inside the
  time cap; gate−4 is not; `deficit` round-trips through replay and both merge
  orders; a boss killed early still unlocks the next world exactly like today.

### Phase 3 — Overtime waves: the wait pays (engine + state, version bump)

Replace free sparring with **גלי הארכה** — overtime waves that cost ⚡ and pay
coins, without moving the world marker. Rules:

- Available whenever the boss is standing and not being fought (gate locked, or the
  player hasn't pressed the button).
- Same ⚡ cost as an ordinary wave; coins at `overtimeCoinFactor` (start at 0.5) of
  the world's last wave; difficulty continues the world's curve gently past its
  last wave and is capped at +50 % of the last wave so a long wait never becomes a
  wall. Mini-boss every 10 as usual.
- `wave_cleared` payload gains `overtime: true`; the reducer folds coins/energy as
  usual and **does not touch `world`/`wave`**. New `battle.overtime: Record<world,
  count>` for the feed and trophies → `GAME_STATE_VERSION` 12 → 13 (old blobs are
  rebuilt from the log, which is the migration).
- Economy: income is bounded by ⚡, and with Phase 1 the wait is 0–3 workouts, so
  overtime adds a few hundred 🪙 per world. Re-check the `< 250,000` campaign
  income bound in `tests/shop.test.ts` with a "trainee who overtimes the whole
  wait" scenario.
- This also drains the bank into gear instead of hoarding it for a binge, which
  smooths the post-gate rhythm.

### Phase 4 — Plan-aware coaching on the gate card (UI, small)

Turn "חסר לכם: ליבה רמה 5" into something actionable, since the gate's real job is
to direct training:

- For each unmet part, show how many sets per week the active plan gives it
  (`bodyPartWeights` over the plan's days × weekdays) and name 2–3 library
  exercises (`EXTRA_EXERCISES`) that feed it, with a "הוסיפו לתוכנית" shortcut into
  the plan editor.
- An ETA: "בקצב שלכם השער ייפתח בעוד ~N אימונים", from the per-part XP gained per
  workout over the last four weeks. Waiting with a number is tolerable; waiting
  without one feels broken.
- Revisit `xp.workoutCompletionBonus` (the equalizer) only after Phase 1 data:
  raising it narrows the ab4 chest lag but also speeds every level for everyone.

### Phase 5 — Docs and verification

- `README.md` §📐 (table, gate columns, "two poles" paragraph), the "GATE TUNING"
  and PHASE notes in `core/balance.ts` / `data/gameContent.ts`, and a line in
  `CLAUDE.md` pointing at the new pacing test.
- The four verify commands (`tsc`, `vitest`, `build`, `verify`) after every phase.

## 5. What this plan deliberately does not do

- **No XP or ⚡ rate increase.** It would inflate levels (the visual cap, the skill
  power curve, the daily challenge and the league are all tuned to today's XP).
- **No energy cap.** The bank isn't the problem; the wait is. A cap punishes anyone
  who takes a week off.
- **No gate removal.** The brief wants visible body-part requirements and they are
  the one thing that steers *which* muscles get trained. Phase 2 keeps them and
  removes only the lock.

## 6. Reproducing the numbers (the pacing harness to pin)

One trainee, driven through the real write path:

- `LocalStore` over a fake storage; for each calendar day matching the plan's
  weekday map, `onSetCompleted` for every set of every exercise (weight rising by
  2.5 kg every third session of an exercise, so PRs land at a realistic rate, reps
  10), then `workout_finished` + `onWorkoutFinished`.
- After each workout: levels per part (`gameOf(store).parts[p].level`) and
  cumulative ⚡ earned.
- `wavesRunOut(world)` = first workout where cumulative ⚡ ≥ Σ (waves × 10 + 30) up
  to that world; `gateOpens(world)` = first workout where `worldGate(world,
  levels)` is unlocked.
- Fights: `createBattle` at the world's last six waves and at `bossWaveOf(world)`
  with `bossRequested`, played with the `playActively` loop from
  `tests/worlds.test.ts` plus `useSkill` for all six skills each tick; gear via
  `sumEquipBonus` over `<slot>_<tier>` and `upgradeMultiplier`.

Plans: the built-in A/B/C on Sun/Tue/Thu, and the ab4 preset on Sun+Wed / Tue /
Thu. Run time ≈20 s for both.

## 7. Suggested order

1. Phase 1 (one session) — immediate relief, content-only, unblocks the reporter.
2. Phase 2 (one to two sessions) — the structural fix; the gate stops being a wall.
3. Phase 4 (one session) — cheap, and it makes any remaining wait legible.
4. Phase 3 (two sessions) — the largest change (state version bump, merge tests);
   worth doing once Phases 1–2 show how long the residual waits actually are.
