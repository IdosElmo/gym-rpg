# CLAUDE.md — working on gym-rpg

Hebrew-first (RTL) offline workout RPG PWA, also in English (LTR) — see `docs/i18n.md`. Vite + strict TypeScript, no framework,
single-file build. Real logged training is the only source of progress (XP, energy,
levels); the game cannot be advanced without it.

## Verify everything with

```bash
npx tsc --noEmit        # strict, no `any` in core modules
npx vitest run          # every test must pass
npm run build           # single self-contained dist/index.html
npm run verify          # zero external references (allowlist in scripts/verify-dist.mjs)
```

## Invariants you must never break

- **Event-sourced state.** Every meaningful action is an event in an append-only log;
  game state is deterministically rebuildable by replay (`rebuildFromEvents`). Reducers
  (`applyGameEvent` in `src/core/xp.ts`) must be idempotent under union merge — two
  devices' logs merged in either order converge (`(ts, id)` total order). New state
  shape ⇒ bump `GAME_STATE_VERSION`; old blobs are rejected and rebuilt from the log —
  that rebuild IS the migration path.
- **Deterministic core.** No `Math.random`/`Date.now` in `src/core/` — seeds and clocks
  are parameters. Combat replays byte-identically for a given seed.
- **100% offline.** No external network calls, fonts, media, or CDNs at runtime.
  `npm run verify` enforces it; the only allowed origins are enumerated with reasons.
- **Legacy parity.** The built-in program (`src/data/program.ts`) is the verbatim port of
  `legacy/index.html`, guarded byte-for-byte by `tests/program.test.ts`. Deliberate
  changes go through its `POST_LEGACY_IDS` (appended exercises) / `AMENDED_FIELDS`
  (coaching-copy amendments) allowlists — never silently.
- **Bilingual UI** (Hebrew RTL is the original, English LTR). Every user-visible string lives
  in a typed catalog under `src/i18n/messages/` (`en: typeof he`), read with `tr()` at render
  time; Hebrew output stays byte-identical when copy moves. Data files stay Hebrew; English
  content is an overlay beside them (`src/i18n/content/*.en.ts`). Language and units are
  device preferences in `UiState`, never in an event; storage is always metric
  (`src/i18n/units.ts`). CSS uses logical properties only. Full rules: `docs/i18n.md`.
- **UI design**: two themes, every colour a token in `styles/tokens.css` defined for both —
  DARK (default: navy `--bg:#0d1b36` + sky `--accent:#5cc8ff`) and LIGHT
  (`<html data-theme="light">`: `--bg:#eceef2`, white cards, same sky). Accent as a FILL is
  `--accent` with `--on-accent` text; accent as TEXT/icon/stroke is `--accent-ink` (deep sky
  in light — #5cc8ff is unreadable on white). Game stages (arena, character, photo viewer)
  stay dark in both. The theme is a device preference (`UiState.theme`, `ui/theme.ts`).
  Touch targets ≥44px, `prefers-reduced-motion` respected, `color-scheme` declared
  (forced-dark defense), `text-size-adjust` pinned (Android font boosting).
- **All storage through `DataStore`** (`src/storage/`). UI never touches `localStorage`.
  Auth/sync bookkeeping lives in `src/sync/` (Supabase; ships dark unless configured).
  Bytes too big for the log (📸 progress photos) go through `BlobStore` (`IdbBlobStore`
  is the only module naming `indexedDB`; `MemoryBlobStore` for tests/fallback) via the
  drivers in `src/core/photos.ts`: the event carries metadata only, the blob is keyed by
  the event's id, `pruneOrphanBlobs` reconciles the two at boot. Photo events are
  `LOCAL_ONLY_EVENTS` — folded and rebuilt like any other, never pushed by the sync engine.

## Adding a built-in exercise — the full checklist

1. **Data** — add the `Exercise` to `src/data/program.ts` (a day's list or
   `EXTRA_EXERCISES`): Hebrew + English names, `equip`, `muscle`, sets/reps/rest/unit,
   Hebrew `steps`/`cue`/`mistake` in the existing coaching voice, and `bodyPart`
   (+ optional `split`, weights summing to 1) so XP flows correctly.
2. **Demo — NOT optional.** The coverage test in `tests/exercisePoses.test.ts`
   ("demonstrates every built-in exercise, exactly once") fails the suite until you
   author a demo in `src/data/exercisePoses.ts`:
   - 2–3 keyframes of absolute segment angles (`-90` up, `90` down, `0` right) driving
     the FK rig in `src/ui/coachFigure.ts`; props (bench/rail/pulley/mat/bars) and the
     held load (`Hold`) are derived from joints — never place equipment by hand.
   - Pick the view: `side` (default), `front` (frontal-plane movements: raises, shrugs,
     crossovers, twists), `threeQuarter` (movements where both arms must read separately
     on a diagonal — flyes, face pull). In turned views, author the far arm explicitly
     when the auto-mirror would flip an elbow's bend (see the elbow-bow tests).
   - If the exercise name/equipment implies two implementations (e.g. Smith/dumbbell),
     ship both as `variants` with Hebrew captions — they render side by side.
3. **Respect the mechanical test sweeps** (they run over every variant): joints in
   stage and within limits, guided bars within 2.5 units of their rail BETWEEN
   keyframes, free-press grips on a straight chord, bodyweight grips welded to their
   bar, load paths never doubling back, elbows never snapping through straight.
4. **Look at it.** Render the SVG and rasterize (sharp is in node_modules; substitute
   the CSS variables with literal hexes first or the PNG comes out black). A test can
   pass while the picture is wrong.
5. Run the four verify commands. The parity test does not apply to `EXTRA_EXERCISES`
   (library-only additions) — only to the three built-in days.

A **cardio** exercise (treadmill incline walk, `x21`) is the same `Exercise` plus a
`cardio: CardioSpec`: `sets` are timed stages, `w` is the stage load (incline %), `r` the
minutes, `rest` the stage length in seconds (it drives the stage timer). Nothing below the
UI changes — same `set_completed`, same volume (`load × minutes`) — but `core/stats.ts`
keeps stages out of tonnage/reps/heaviest-set, and the workout screen, history, stats
and editor read the two columns through `isCardio`. Add a new cardio movement the same
way (a spec, a demo, a `tests/cardio.dom.test.ts`-style check of the ladder).

## Adding other content

- **Worlds/enemies/bosses** (eleven worlds, 8–9 regulars + a mini-boss + a boss each): `src/data/gameContent.ts` + tuning in `src/core/balance.ts`. Append new regulars at the END of a roster (waves 1–7 of every world are pinned); growing a roster changes which enemy later waves meet, which is fine (payloads are authoritative) but re-pins world 1's golden numbers.
  Wave counts (`waves`) and ramp steepness (`span`) are per world; historical
  `wave_cleared`/`boss_defeated` payloads are authoritative, so content changes must
  never re-derive history. **Pacing is measured, not estimated**: `tests/pacing.test.ts`
  drives a simulated trainee (`tests/helpers/trainee.ts`) through the real
  `onSetCompleted` path on both shipped plans and pins that every world's waves run out
  within a few workouts of its boss gate opening, that the late waves are the wall (not
  the gate), and that every boss is a 25–90 s climax in era gear. Retune all three
  numbers together (`waves`, `span`, `requires`/`hpMult`) and re-run it. The gate is a
  recommendation: below it the boss is fought strengthened by the deficit
  (`BALANCE.combat.boss.handicap`), and the wait at a standing boss runs paid overtime
  waves (`BALANCE.combat.overtime`, `battle.overtime` in state). Coins never follow
  `span` (`coinStretch`); `tests/shop.test.ts` bounds the campaign's income.
- **Food catalog** (🍽️ תזונה): `src/data/foods.ts` — foods priced per 100 g as eaten, each
  unit a weight in grams, plus fixed meals as component lists (one portion). Stable ids
  (they are stored on logged meals); `catalogProblems()` must stay `[]` and
  `tests/catalog.test.ts` pins the fixed meals' prices — re-pin deliberately. A pick is
  priced in code (`core/catalog.ts`) and frozen into its `meal_logged` payload, so editing
  the catalog never rewrites history. The same catalog rides to the ✨ estimator as hints.
- **Exercise library groups**: new built-ins go in their group's marked section of
  `EXTRA_EXERCISES` (`program.ts`), `exercisePoses.ts` and `i18n/content/program.en.ts` —
  GYM `g*` (barbell/cable/machine), HOME `h*` (dumbbells/bands), BODYWEIGHT `w*` (home or
  outdoors, no equipment). Re-pin the counts in `tests/exercisePoses.test.ts` and
  `tests/i18n.content.test.ts` deliberately.
- **Plan library** (`src/data/planLibrary.ts`, built by `src/core/planLibrary.ts`): 30 templates,
  days 2–6 × location (`gym` / `home_dumbbells` / `home_none`) × men's/women's variation, each
  obeying its location's equipment rule (tests enforce it). The questionnaire's goal,
  experience, session length and injuries are applied when a plan is BUILT
  (`buildLibraryPlan`), never stored on the template. `recommendPreset` (core/profile.ts) maps
  a profile to a template. `builtin3` / `ab4` (`PLAN_PRESETS`) stay byte-identical.
- **Ready meals & menus**: `READY_MEALS` (everyone) are separate from the owners' `FIXED_MEALS`
  (shown only to an account that ate them, `myFixedMeals`). Daily sample menus are data over
  ready meals; a user's own saved meals are `meal_template_saved` / `meal_template_deleted`
  events folded into `NutritionState`. Carbs/fat are optional on meals and targets — unknown
  is never 0.
- **Equipment** (seven slots, helmet to cape): `EQUIPMENT` in `gameContent.ts`; a new slot needs a
  layer + anchor + flair spot in `ui/characterSvg.ts` (the artwork sweeps cover it); stats flow through `equippedBonus`/
  `deriveStats` (the single stat seam). Art anchors to `characterAnchors`; upgrade flair
  via the per-item `<feDropShadow>` (explicit hex — CSS vars inside SVG filters break on
  Samsung).
- **Events**: extend `applyGameEvent` only (live path and replay share it); add the type
  + payload to `src/storage/DataStore.ts`; unique idempotency keys or high-water-mark /
  per-date ledger semantics; both merge orders tested.

## Owner dev mode

Email-hash-gated (`src/dev/`): the 🛠 panel in settings + `window.gymDev`. All grants are
real events marked `dev: true`; `dev_purge` reverts them exactly. The raw email must
never appear in the tree — only its SHA-256 hex.
