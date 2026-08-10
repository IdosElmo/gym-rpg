# Project Brief: "Gym RPG" — Gamified Offline Workout App

You are working in a fresh repo. It contains one file: `index.html` — a complete, working, 100% offline Hebrew (RTL) workout tracking SPA for a 3-day hypertrophy program (Workout A/B/C: chest, back, legs, shoulders, arms, core). It has exercise cards, set logging (weight/reps/done), previous-performance display, an auto-starting floating rest timer with Web Audio chime, workout history, and JSON export/import. All data lives in `localStorage` under the key `hyp3_data_v1` (shape: `{sessions: {"YYYY-MM-DD": {day: "A"|"B"|"C", ex: {exerciseId: [{w,r,done}, ...]}}}}`) and UI state under `hyp3_ui_v1`.

Your mission has two parts: **(1) migrate this into a proper TypeScript project** without losing any existing behavior or user data, and **(2) build a game layer on top**: an RPG character whose body parts level up from real workouts and who fights in an idle/auto-battler mode.

Read `index.html` fully before writing any code — it is the source of truth for the workout program data, Hebrew copy, styling tokens, and timer behavior.

---

## Part 1 — Migration & Infrastructure (do this first, as its own commits)

### Stack
- **Vite + TypeScript (strict mode)**, vanilla TS — no React/Vue/framework. Keep it small and fast.
- **`vite-plugin-singlefile`**: `npm run build` must emit a single self-contained `dist/index.html` that works offline when opened directly.
- **PWA**: add a manifest + a simple Service Worker (precache the built assets) so the app is installable ("Add to Home Screen") and works fully offline when hosted. Generate a simple SVG-based app icon (dumbbell/character themed, dark background `#121824`).
- **GitHub Pages deploy**: add a GitHub Actions workflow that builds and deploys `dist/` to Pages on every push to `main`. Set the correct Vite `base` path for project pages.

### Architecture (module layout)
```
src/
  data/program.ts        // the 3-day program: exercises, Hebrew/English names, steps, cues, rest times (port verbatim from index.html)
  data/gameContent.ts    // enemies, bosses, worlds, equipment definitions
  storage/DataStore.ts   // abstract interface: load/save/subscribe + append(event)
  storage/LocalStore.ts  // localStorage implementation (the only one for now)
  storage/migrate.ts     // migrations, incl. importing legacy hyp3_data_v1 data
  core/workout.ts        // session state, prev-performance lookup
  core/xp.ts             // XP formulas, levels, streaks
  core/combat.ts         // battle loop, energy, waves, bosses (pure logic, no DOM)
  ui/                    // screens: workout, character, battle, history + shared components
  ui/timer.ts            // rest timer (port existing behavior + Web Audio chime)
  main.ts
styles/                  // CSS (plain CSS or CSS modules; keep existing design tokens)
```

### Sync-ready data model (important for the future)
The app must remain **local-first**, but structure data so a cloud sync backend (e.g. Supabase) can be added later without a rewrite:
- All writes go through the `DataStore` interface; UI code never touches `localStorage` directly.
- Alongside current-state storage, record an **append-only event log**: every meaningful action is an event `{id: uuid, ts: epochMs, type, payload}` — e.g. `set_logged`, `set_completed`, `workout_finished`, `xp_gained`, `level_up`, `battle_won`, `boss_defeated`, `item_equipped`. Game state must be **deterministically rebuildable by replaying events** (write a `rebuildFromEvents()` and use it in tests). This makes future multi-device merge trivial.
- Version every stored blob (`schemaVersion`) and route all reads through `migrate.ts`.
- **Migration requirement**: on first load, if legacy `hyp3_data_v1` exists, import it losslessly (sessions history must survive) and grant retroactive XP for it (see XP rules) so existing workouts count.

### Non-negotiable constraints
- 100% offline. No external network calls, fonts, CDNs, or audio files at runtime. Chime stays Web Audio-synthesized.
- Hebrew-first, `dir="rtl"`, all UI copy in Hebrew (keep English exercise subtitles).
- Keep the existing dark design tokens: bg `#121824`, card `#1E2638`, accent `#3B82F6`, success `#10B981`, timer amber `#F59E0B`. Game screens may extend the palette but must feel like the same app.
- Mobile-first (one-handed use mid-workout). Touch targets ≥ 40px. Respect `prefers-reduced-motion`.
- All existing features must keep working exactly: tabs, logging, prev performance, auto rest timer (+15/−15/pause/reset, floating, flash + chime), history, export/import JSON (export now includes game state too).

---

## Part 2 — The Game

### Core loop
Real training → body-part XP → character gets stronger → wins auto-battles → hits a boss gate → must train again. **Golden rule: the game cannot be progressed without real logged workouts.**

### Character & body parts
Six body parts, each with its own level, each feeding a different combat stat:

| Body part | Fed by (exercise → part mapping) | Combat stat |
|---|---|---|
| חזה (Chest) | all presses, flyes, dips | Attack power (ATK) |
| גב (Back) | rows, lat pulldown/pull-ups | Defense (DEF) |
| רגליים (Legs) | lunges, RDL | Max HP |
| כתפיים (Shoulders) | shoulder press | Attack speed |
| ידיים (Arms) | bicep curls, tricep extension | Crit chance & crit damage |
| ליבה (Core) | plank, leg raises, crunches | HP regen in battle |

Add an explicit `bodyPart` field to every exercise in `data/program.ts`. Exercises that hit two parts (e.g. dips → chest+arms) may split XP 70/30.

**Character rendering**: build the character as a layered inline **SVG** whose proportions scale with body-part levels — chest level visibly widens the torso, legs level thickens the legs, etc. (clamped so it stays charming, not grotesque). This is the signature visual payoff; make level-ups feel great (brief glow/pulse animation on the grown part). Style: simple, bold, slightly cartoonish silhouette that fits the dark UI. Equipment (Part 2c) renders as additional SVG layers.

### XP rules (`core/xp.ts`, pure functions + unit tests)
- Completing a set: `baseXP (10) × volumeFactor`, where `volumeFactor = clamp((weight×reps) / previousBest(weight×reps) , 0.5, 1.5)`; bodyweight/seconds exercises use reps or seconds as volume.
- **New personal record (weight×reps for that exercise) → ×2 XP** on that set + a `pr_achieved` event (show a celebratory toast).
- Finishing all sets of all exercises in a day's workout → flat bonus XP to **every** body part + bonus battle energy.
- Level curve: `xpForLevel(n) = 100 × 1.35^(n−1)`. Show progress bars per part.
- Character level = sum-derived (e.g. average of part levels, rounded down) — displayed as the headline level.
- **Streak**: 3 distinct workout days within a calendar week (Sun–Sat) = "perfect week" → permanent stacking buff `+10%` all stats per streak tier. A week with <3 workouts drops the tier by 1 (never below 0, never removes earned levels). Retroactive import grants XP but starts streak at 0.

### Battle mode (`core/combat.ts`, pure logic; UI renders it)
A fourth tab: **🎮 קרב**.
- **Idle auto-battle**: character auto-attacks enemy waves; player taps the enemy for bonus hits; taps charge a **super-move** meter (big hit + screen shake).
- **Energy economy**: each completed real set grants battle energy (e.g. +10; workout completion +50). Every wave consumes energy. At 0 energy the character "rests" — battles pause until the next real workout. No energy grinding in-game. Balance targets: one full workout ≈ 15–25 waves of progress.
- **Progression**: waves → mini-boss every 10 waves → world boss. 4 worlds to start: חדר כושר נטוש → הרחוב → הזירה → הר האולימפוס. Define enemies/bosses with Hebrew names + simple SVG sprites in `data/gameContent.ts`.
- **Boss gates**: each boss has body-part level requirements (e.g. "דורש חזה רמה 5 ורגליים רמה 4"). Show requirements clearly with met/unmet states; locked bosses explain exactly what training is missing.
- **Combat math**: `damage = ATK × (1 ± 10% variance)`, crit via Arms stats, enemy damage reduced by DEF, HP from Legs, regen per tick from Core, attack interval from Shoulders. Tune numbers so stats all matter; put all tuning constants in one `balance.ts` file.
- **Rewards**: coins per wave/boss → shop with equipment (gloves, belt, shoes, cape…) that adds stats and renders on the character SVG. Boss kills unlock the next world + a cosmetic trophy on the character screen.
- Battle simulation must be **deterministic given a seed** (seed stored in events) so it's testable and replay-safe.
- Battles only run while the tab is open (no offline earnings) — keep it honest and simple for v1.

### Screens summary
1. **אימון** (existing 3 day-tabs) — unchanged, plus floating "+XP חזה!" fly-up animations when sets are checked, and an energy counter.
2. **דמות** — the SVG character, headline level, six part progress bars, streak tier, equipped items, trophies.
3. **קרב** — battle arena, energy bar, wave counter, world map / boss gates.
4. **היסטוריה** — existing history + a feed of game events (level-ups, PRs, bosses defeated).

---

## Working instructions
- Work in phases with meaningful commits: **(0)** scaffold + migration + PWA + Pages CI, **(1)** XP/character/body parts + character screen, **(2)** battle loop + energy + waves, **(3)** bosses, worlds, equipment, streak. After each phase the app must be fully usable and buildable.
- TypeScript `strict: true`; no `any` in core modules.
- Add **Vitest** unit tests for `xp.ts`, `combat.ts`, `migrate.ts` (including: legacy-data import, PR detection, level curve, deterministic battle with fixed seed, event replay rebuild).
- After each phase run `npm run build` and verify the single-file `dist/index.html` opens and works from the filesystem.
- Keep `README.md` updated (Hebrew ok): how to run, build, deploy, and the data model.
- If any spec detail is ambiguous, make a sensible choice, note it in the commit message, and keep going — don't stall.

Start with Phase 0 now.
