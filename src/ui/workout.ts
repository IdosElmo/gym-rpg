/**
 * ui/workout.ts — the workout screen (exercise cards + set logging).
 *
 * A 1:1 port of the legacy render: order badge, Hebrew + English titles, muscle
 * / scheme / equipment badges, a collapsible "הסבר ודגשי ביצוע" panel with the
 * numbered steps + cue + common-mistake blocks, the 3-column log table with
 * previous-performance hints, the rest hint, and the green `done-all` state.
 *
 * All writes go through the `DataStore` — this module never touches storage.
 *
 * Phase 1 adds the game feedback: an XP fly-up per body part when a set is
 * checked, a PR / level-up toast, and the workout-completion bonus. XP itself is
 * granted by `core/game.ts`, which is also the only place that guards against
 * farming XP by unchecking and re-checking a set.
 *
 * SUPERSETS — a rendering rule and a tap rule, and NOTHING below them
 * -------------------------------------------------------------------
 * Two adjacent exercises the PLAN links (`PlanDay.supersets`) render as one
 * violet group with one shared rest, and one ✓ tap completes the same set on
 * both. That is the whole feature: the tap appends the two ORDINARY
 * `set_completed` events the two checkboxes would have appended on their own
 * (each with its own logged weight/reps) and calls the same `onSetCompleted`
 * grant path once per exercise. No new event type, no reducer change, no state
 * version — so every idempotency guard, the merge convergence, PR detection and
 * the history screen keep working with no knowledge of supersets at all.
 *
 * CARDIO — the same table, read differently
 * -----------------------------------------
 * A cardio exercise (`Exercise.cardio`, the treadmill incline walk) is a ladder
 * of timed STAGES, and a stage is a set: the same row, the same ✓, the same
 * `set_completed` event with the same two numbers — only now they are the load
 * (incline %) and the minutes. This screen renames the columns, prefills an
 * untouched stage from the LADDER when there is no history to prefer, and turns
 * the rest timer into a stage timer: ✓ on stage N starts the countdown of stage
 * N+1 with its new incline in the label, and a ▶ button starts the first one.
 * Nothing below the DOM knows the difference.
 */

import {
  BODY_PART_HE,
  dayOf,
  equipHe,
  isCardio,
  stageLoad,
  stageMinutes,
  type DayKey,
  type Exercise,
  type ResolvedProgram,
} from '../data/program.ts';
import {
  doneCount,
  getSetData,
  isWorkoutComplete,
  prevPerf,
  todayISO,
} from '../core/workout.ts';
import { planDay, resolveProgram, supersetPairs, type SupersetPair } from '../core/plan.ts';
import { closeDueWeeks, onSetCompleted, onWorkoutFinished, type GrantResult } from '../core/game.ts';
import type { AppState, DataStore } from '../storage/DataStore.ts';
import { fmtClock, type RestTimer } from './timer.ts';
import { queuePartPulse } from './character.ts';
import { esc } from './dom.ts';
import { mountExerciseDemo, type DemoHandle } from './exerciseDemo.ts';
import { toast } from './toast.ts';
import { flyXp, fmtXp } from './xpfx.ts';

/**
 * THE LIVE DEMONSTRATIONS, by exercise id.
 *
 * A demo owns a `requestAnimationFrame` loop, so it must be disposed rather
 * than dropped: every re-render of this screen tears the whole map down first,
 * and closing a panel disposes just that one. (The loop also parks itself the
 * moment its element leaves the document — see `ui/exerciseDemo.ts` — so a
 * navigation away can never leave one spinning either; this map is what makes
 * the common cases deterministic instead of one frame late.)
 */
const demos = new Map<string, DemoHandle>();

function disposeDemos(): void {
  for (const d of demos.values()) d.destroy();
  demos.clear();
}

/** Mount the demo of an OPEN card, if that exercise has poses at all. */
function openDemo(card: Element | null, ex: Exercise): void {
  if (!card || demos.has(ex.id)) return;
  const panel = card.querySelector<HTMLElement>('.form-panel');
  if (!panel) return;
  const handle = mountExerciseDemo(panel, ex.id, { label: `הדגמת ביצוע: ${ex.he}` });
  if (!handle) return;
  // The demo leads the drawer: picture first, then the numbered steps.
  panel.insertBefore(handle.el, panel.firstChild);
  demos.set(ex.id, handle);
}

function closeDemo(exId: string): void {
  demos.get(exId)?.destroy();
  demos.delete(exId);
}

export interface WorkoutDeps {
  store: DataStore;
  timer: RestTimer;
  /** Re-render the header only (last-logged date can change on every keystroke). */
  refreshHeader: () => void;
}

export function renderWorkout(main: HTMLElement, view: DayKey, deps: WorkoutDeps): void {
  const { store } = deps;
  disposeDemos();
  const state = store.getState();
  // The user's plan when there is one, the built-in PROGRAM object itself when
  // there isn't — so an un-edited install renders exactly the same objects.
  const program = resolveProgram(state.plan);
  const p = dayOf(program, view);
  const today = todayISO();

  // A day key the plan does not (or no longer) has: say so instead of throwing.
  // Reachable when a day is deleted on another device while this tab is open.
  if (!p) {
    main.innerHTML = `<div class="empty">יום האימון הזה כבר לא קיים בתוכנית. בחרו יום אחר או ערכו את התוכנית. 🛠</div>`;
    return;
  }

  // The linkage is PLAN data (the built-in program has none), and it is kept
  // only where the resolved day still shows the two exercises side by side.
  const pairs = livePairs(p.exercises, supersetPairs(planDay(state.plan, view)));
  const pairAt = new Map(pairs.map((pair) => [p.exercises.findIndex((e) => e.id === pair[0]), pair] as const));

  const card = (ex: Exercise, idx: number, partner: Exercise | null): string => {
    const prev = prevPerf(state, ex.id, today);
    const rows: string[] = [];
    let done = 0;
    const cardio = ex.cardio ?? null;
    // the load column: kilograms for a lift, the stage's own unit for cardio
    const loadUnit = cardio ? cardio.loadUnit : 'ק"ג';
    for (let i = 0; i < ex.sets; i++) {
      const d = getSetData(state, view, ex.id, i, false, today) ?? { w: '', r: '', done: false };
      if (d.done) done++;
      let prevTxt = '';
      const ps = prev?.sets[i];
      if (ps && (ps.w !== '' || ps.r !== '')) {
        const pw = ps.w;
        const pr = ps.r;
        prevTxt =
          'אימון קודם: ' +
          (pw !== '' ? esc(pw) + (cardio ? esc(loadUnit) : ' ' + loadUnit) : '') +
          (pw !== '' && pr !== '' ? ' × ' : '') +
          (pr !== '' ? esc(pr) + (cardio ? ' דק׳' : '') : '');
      }
      // PREFILL FROM LAST TIME. A set the user has not touched today (nothing
      // typed, not checked) starts out showing the same set's numbers from the
      // previous session, dimmed (`prefill`), so a workout that repeats last
      // week's weights is logged with ✓ taps alone. It is a SUGGESTION, not
      // data: the store is untouched until the user types (which replaces it)
      // or checks the set (which adopts what the row visibly says — see the
      // ✓ handler). A set with no history stays empty, exactly as before.
      // A cardio stage with no history behind it prefills from the LADDER the
      // exercise describes (incline 1, 2, 3… for 5 minutes each) — the same
      // dimmed suggestion, adopted by ✓ or replaced by typing, so the very
      // first treadmill session is logged with ✓ taps alone too. History,
      // when there is any, still wins: last time's numbers are the user's.
      const untouched = !d.done && d.w === '' && d.r === '';
      const hint = ps ?? (cardio ? { w: fmtNum(stageLoad(ex, i)), r: fmtNum(stageMinutes(ex)) } : null);
      const fillW = untouched && hint ? hint.w : d.w;
      const fillR = untouched && hint ? hint.r : d.r;
      rows.push(`
    <div class="log-row ${d.done ? 'checked' : ''}">
      <div class="set-num">${i + 1}</div>
      <div class="inp-wrap">
        <input class="inp ${fillW !== d.w ? 'prefill' : ''}" type="number" inputmode="decimal" step="0.5" min="0" placeholder='${cardio ? esc(loadUnit) : 'ק"ג'}'
          value="${esc(fillW)}" data-ex="${esc(ex.id)}" data-set="${i}" data-f="w">
        <span class="prev">${prevTxt}</span>
      </div>
      <div class="inp-wrap">
        <input class="inp ${fillR !== d.r ? 'prefill' : ''}" type="number" inputmode="${cardio ? 'decimal' : 'numeric'}" ${cardio ? 'step="0.5"' : ''} min="0" placeholder="${esc(ex.unit)}"
          value="${esc(fillR)}" data-ex="${esc(ex.id)}" data-set="${i}" data-f="r">
        <span class="prev"></span>
      </div>
      <button class="chk ${d.done ? 'on' : ''}" data-ex="${esc(ex.id)}" data-set="${i}" aria-label="סמן סט ${i + 1} כהושלם">✓</button>
    </div>`);
    }
    const open = state.ui.open[ex.id] ? 'open' : '';
    const allDone = done === ex.sets ? 'done-all' : '';
    // A custom exercise has no coaching copy, so it gets no toggle and no
    // panel at all — an empty "הסבר ודגשי ביצוע" drawer would just be a lie.
    const hasGuide = ex.steps.length > 0 || ex.cue !== '' || ex.mistake !== '';
    const guide = hasGuide
      ? `<button class="form-toggle" data-toggle="${esc(ex.id)}">
      <span>הסבר ודגשי ביצוע</span><span class="chev">▾</span>
    </button>
    <div class="form-panel">
      ${ex.steps.length > 0 ? `<h4>שלבי ביצוע</h4><ol>${ex.steps.map((s) => `<li>${s}</li>`).join('')}</ol>` : ''}
      ${ex.cue ? `<div class="cue">💡 <b>דגש:</b> ${ex.cue}</div>` : ''}
      ${ex.mistake ? `<div class="mistake">⚠️ ${ex.mistake}</div>` : ''}
    </div>`
      : '';
    return `
  <section class="ex-card ${open} ${allDone}" id="card-${esc(ex.id)}">
    <div class="ex-head">
      <div class="ex-order">תרגיל ${idx + 1} / ${p.exercises.length}</div>
      <h2 class="ex-title">${esc(ex.he)}</h2>
      <div class="ex-title-en">${esc(ex.en)}</div>
      <div class="badges">
        ${partner ? `<span class="badge superset">🔗 סופר־סט עם ${esc(partner.he)}</span>` : ''}
        <span class="badge muscle">🎯 ${esc(ex.muscle)}</span>
        <span class="badge scheme">${ex.sets} ${cardio ? 'שלבים' : 'סטים'} × ${esc(ex.reps)}</span>
        ${ex.equip.map((e) => `<span class="badge equip">${esc(equipHe(e))}</span>`).join('')}
      </div>
    </div>
    ${guide}
    <div class="log">
      <div class="log-row head">
        <div style="text-align:center">${cardio ? 'שלב' : 'סט'}</div><div style="text-align:center">${cardio ? `${esc(cardio.loadLabel)} (${esc(loadUnit)})` : 'משקל (ק"ג)'}</div>
        <div style="text-align:center">${esc(ex.unit)}</div><div style="text-align:center">✓</div>
      </div>
      ${rows.join('')}
      ${
        // Inside a superset the rest belongs to the PAIR, not to the card:
        // the group prints one shared line at its bottom instead.
        partner
          ? ''
          : cardio
            ? `<div class="rest-hint">⏱ כל שלב ${fmtClock(ex.rest)} דק׳ · סימון ✓ בסוף שלב מפעיל את הטיימר של השלב הבא</div>
      <button class="stage-start" data-stage="${esc(ex.id)}" ${done >= ex.sets ? 'hidden' : ''}>${stageButtonText(ex, done)}</button>`
            : `<div class="rest-hint">⏱ מנוחה מומלצת: ${ex.rest} שניות (מתחיל אוטומטית בסימון סט)</div>`
      }
    </div>
  </section>`;
  };

  const blocks: string[] = [];
  for (let i = 0; i < p.exercises.length; ) {
    const pair = pairAt.get(i);
    const a = p.exercises[i];
    const b = p.exercises[i + 1];
    if (pair && a && b) {
      blocks.push(groupHtml(a, b, card(a, i, b), card(b, i + 1, a), bothDone(state, a, b, today)));
      i += 2;
    } else if (a) {
      blocks.push(card(a, i, null));
      i += 1;
    } else break;
  }
  main.innerHTML = blocks.join('');

  bind(main, view, deps, today, program, pairs);
}

/**
 * The pairs of a day that the RESOLVED program can actually render: both
 * exercises present, and still standing next to each other. (A row whose
 * definition vanished is dropped by `resolveProgram`, which can leave a pair
 * pointing across a hole — it then simply renders as two ordinary cards.)
 */
function livePairs(exercises: readonly Exercise[], pairs: readonly SupersetPair[]): SupersetPair[] {
  const out: SupersetPair[] = [];
  for (const pair of pairs) {
    const i = exercises.findIndex((e) => e.id === pair[0]);
    if (i >= 0 && exercises[i + 1]?.id === pair[1]) out.push(pair);
  }
  return out;
}

/** True when every set of BOTH halves of a superset is checked (group done-all). */
function bothDone(state: AppState, a: Exercise, b: Exercise, date: string): boolean {
  return doneCount(state, a.id, date) >= a.sets && doneCount(state, b.id, date) >= b.sets;
}

/** Two cards welded into one superset: chip, joint, and ONE shared rest line. */
function groupHtml(a: Exercise, b: Exercise, cardA: string, cardB: string, done: boolean): string {
  return `
    <div class="ss-group ${done ? 'done-all' : ''}" id="ss-${esc(a.id)}" data-ss-a="${esc(a.id)}" data-ss-b="${esc(b.id)}">
      <div class="ss-head">
        <span class="ss-chip">🔗 סופר־סט</span>
        <span class="ss-sub">שני התרגילים — ✓ אחד · מנוחה אחת</span>
      </div>
      ${cardA}
      <div class="ss-joint"><span>🔗 בלי מנוחה — ישר לתרגיל הבא</span></div>
      ${cardB}
      <div class="ss-rest">⏱ מנוחה משותפת: ${sharedRest(a, b)} שניות — טיימר אחד, מתחיל בסימון הזוג</div>
    </div>`;
}

/**
 * THE rest of a superset: the first exercise's. The editor keeps the two rows
 * in step, so they normally agree anyway; when a document from elsewhere says
 * otherwise, the pair's own order decides — never whichever card was tapped.
 */
function sharedRest(a: Exercise, _b: Exercise): number {
  return a.rest;
}

/** A number the way the log's inputs print it: "1", "2.5" — never "1.0". */
function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** The ▶ button's caption: the stage it would time, out of the ladder. */
function stageButtonText(ex: Exercise, done: number): string {
  const n = Math.min(done, ex.sets - 1) + 1;
  return `▶ טיימר לשלב ${n} מתוך ${ex.sets}`;
}

/**
 * Start the timer for stage `n` (0-based) of a cardio exercise: the stage's
 * length on the clock, the stage and its load on the label, and — when it
 * chimes — "raise the incline" rather than "back to the bar".
 */
function startStage(timer: RestTimer, ex: Exercise, n: number, load: string): void {
  if (!isCardio(ex)) return;
  const c = ex.cardio;
  const last = n + 1 >= ex.sets;
  const at = load !== '' ? ` · ${c.loadLabel} ${load}${c.loadUnit}` : '';
  timer.start(ex.rest, `🏃 שלב ${n + 1}/${ex.sets}${at}`, {
    sub: 'טיימר שלב',
    doneLabel: last ? 'השלב האחרון הסתיים — סמנו ✓ 🏁' : `שלב ${n + 1} הסתיים — סמנו ✓ והעלו ${c.loadLabel}! 💪`,
  });
}

/** Keep the ▶ button in step with the stages ✓'d so far (hidden once all are). */
function syncStageButton(main: HTMLElement, ex: Exercise, done: number): void {
  const btn = main.querySelector<HTMLButtonElement>(`.stage-start[data-stage="${cssId(ex.id)}"]`);
  if (!btn) return;
  btn.hidden = done >= ex.sets;
  btn.textContent = stageButtonText(ex, done);
}

function findEx(program: ResolvedProgram, view: DayKey, exId: string): Exercise | undefined {
  return dayOf(program, view)?.exercises.find((e) => e.id === exId);
}

function bind(
  main: HTMLElement,
  view: DayKey,
  deps: WorkoutDeps,
  today: string,
  program: ResolvedProgram,
  pairs: readonly SupersetPair[],
): void {
  const { store, timer, refreshHeader } = deps;

  // Panels that are already open when the screen renders get their demo now;
  // the rest get one the moment they are opened.
  for (const ex of dayOf(program, view)?.exercises ?? []) {
    if (store.getState().ui.open[ex.id]) openDemo(document.getElementById('card-' + ex.id), ex);
  }

  main.querySelectorAll<HTMLButtonElement>('.form-toggle').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset['toggle'];
      if (!id) return;
      store.update((draft) => {
        draft.ui.open[id] = !draft.ui.open[id];
      });
      const card = b.closest('.ex-card');
      card?.classList.toggle('open');
      // A closed drawer keeps NO demo: the element goes away with its loop, so
      // a page of collapsed cards costs exactly nothing.
      const ex = findEx(program, view, id);
      if (ex && card?.classList.contains('open')) openDemo(card, ex);
      else closeDemo(id);
    });
  });

  main.querySelectorAll<HTMLInputElement>('.inp').forEach((inp) => {
    inp.addEventListener('input', () => {
      const exId = inp.dataset['ex'];
      const field = inp.dataset['f'];
      const i = Number(inp.dataset['set']);
      if (!exId || (field !== 'w' && field !== 'r') || !Number.isInteger(i)) return;
      // Whatever is in the box is the user's number now, not a suggestion.
      inp.classList.remove('prefill');
      let w = '';
      let r = '';
      store.update((draft) => {
        const d = getSetData(draft, view, exId, i, true, today);
        if (!d) return;
        d[field] = inp.value;
        w = d.w;
        r = d.r;
      });
      store.append('set_logged', { date: today, day: view, exId, setIndex: i, w, r });
      refreshHeader();
    });
  });

  /** The input of one (exercise, set, field) cell — where the prefill lives. */
  const inputOf = (exId: string, i: number, f: 'w' | 'r'): HTMLInputElement | null =>
    main.querySelector<HTMLInputElement>(`.inp[data-ex="${cssId(exId)}"][data-set="${i}"][data-f="${f}"]`);

  // ▶ on a cardio card: time the first stage not yet ✓'d, with the load its
  // row shows (prefilled or typed) on the label.
  main.querySelectorAll<HTMLButtonElement>('.stage-start').forEach((b) => {
    b.addEventListener('click', () => {
      const exId = b.dataset['stage'];
      const ex = exId ? findEx(program, view, exId) : undefined;
      if (!ex || !isCardio(ex)) return;
      const n = Math.min(doneCount(store.getState(), ex.id, today), ex.sets - 1);
      startStage(timer, ex, n, inputOf(ex.id, n, 'w')?.value ?? '');
    });
  });

  main.querySelectorAll<HTMLButtonElement>('.chk').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exId = btn.dataset['ex'];
      const i = Number(btn.dataset['set']);
      if (!exId || !Number.isInteger(i)) return;
      const ex = findEx(program, view, exId);
      if (!ex) return;

      // A superset moves as one: the pair, IN CARD ORDER, so the two events,
      // the two grants and the two fly-ups are the same whichever ✓ was
      // tapped. A set the partner does not have (a document from elsewhere
      // with mismatched set counts) is left alone rather than invented.
      const pair = pairs.find((p) => p[0] === exId || p[1] === exId);
      const group = pair
        ? (pair
            .map((id) => findEx(program, view, id))
            .filter((e): e is Exercise => !!e && i < e.sets))
        : [ex];
      const targets = group.some((e) => e.id === exId) ? group : [ex];

      let nowDone = false;
      const logged: { ex: Exercise; w: string; r: string }[] = [];
      store.update((draft) => {
        const tapped = getSetData(draft, view, exId, i, true, today);
        if (!tapped) return;
        nowDone = !tapped.done;
        for (const target of targets) {
          const d = getSetData(draft, view, target.id, i, true, today);
          if (!d) continue;
          // ADOPT THE PREFILL. A field the user never typed into is empty in
          // the draft while the row visibly shows last session's number
          // (`prefill` — see the render); checking the set means "yes, that" —
          // so the visible value becomes the logged one. A field the user
          // typed (or cleared) already matches its input, so this is a no-op
          // for it, and the store stays the single source of what was lifted.
          if (nowDone) {
            if (d.w === '') d.w = inputOf(target.id, i, 'w')?.value ?? '';
            if (d.r === '') d.r = inputOf(target.id, i, 'r')?.value ?? '';
          }
          d.done = nowDone;
          logged.push({ ex: target, w: d.w, r: d.r });
        }
      });
      if (logged.length === 0) return;

      // Two ORDINARY set events — exactly what tapping the two checkboxes one
      // after the other would have appended, each with its own numbers.
      for (const l of logged) {
        store.append(nowDone ? 'set_completed' : 'set_uncompleted', {
          date: today,
          day: view,
          exId: l.ex.id,
          setIndex: i,
          w: l.w,
          r: l.r,
        });
      }

      const state = store.getState();
      for (const l of logged) {
        // An adopted suggestion is a real entry now — drop the dimmed look.
        inputOf(l.ex.id, i, 'w')?.classList.remove('prefill');
        inputOf(l.ex.id, i, 'r')?.classList.remove('prefill');
        const box = main.querySelector<HTMLButtonElement>(`.chk[data-ex="${cssId(l.ex.id)}"][data-set="${i}"]`);
        box?.classList.toggle('on', nowDone);
        box?.closest('.log-row')?.classList.toggle('checked', nowDone);
        // The 🔗 mark says "this one was ticked by its twin" — so it goes on
        // the box the finger did NOT land on, and comes off both otherwise.
        markTwin(box, nowDone && l.ex.id !== exId);
        document
          .getElementById('card-' + l.ex.id)
          ?.classList.toggle('done-all', doneCount(state, l.ex.id, today) === l.ex.sets);
      }
      if (pair) {
        const a = findEx(program, view, pair[0]);
        const b = findEx(program, view, pair[1]);
        if (a && b) document.getElementById('ss-' + a.id)?.classList.toggle('done-all', bothDone(state, a, b, today));
      }
      if (isCardio(ex)) syncStageButton(main, ex, doneCount(state, ex.id, today));

      if (nowDone) {
        // ONE timer for the pair: the whole point of a superset is that the
        // rest comes after both exercises, not between them.
        const lead = logged[0]?.ex ?? ex;
        if (pair && logged.length > 1) timer.start(lead.rest, `🔗 סופר־סט · סט ${i + 1} הושלם`);
        // A cardio ✓ closes stage i, so the clock that starts is the NEXT
        // stage's — with its new incline on the label — and none after the last.
        else if (isCardio(ex)) {
          if (i + 1 < ex.sets) startStage(timer, ex, i + 1, inputOf(ex.id, i + 1, 'w')?.value ?? '');
        } else timer.start(ex.rest, `${ex.he} · סט ${i + 1} הושלם`);

        const grants = logged.map((l) => ({
          ex: l.ex,
          grant: onSetCompleted(store, { date: today, day: view, ex: l.ex, setIndex: i, w: l.w, r: l.r }),
        }));
        celebrateSet(btn, exId, grants);
        // One tap, one completion check and one week-close — never one per
        // exercise: both are idempotent, but the fly-up and the toast are not.
        maybeFinishWorkout(store, view, today, btn, program);
        // THE LEAGUE'S "time passed" hook, beside `refreshStreak`'s on boot.
        // A week closes by the calendar, so the app has to notice — and the
        // first set of a session is the moment it is certainly awake, even if
        // it has been open since before Saturday midnight. `closeDueWeeks` is
        // idempotent and returns without writing (or committing) anything when
        // nothing is due, which is every call but the first of a new week.
        closeDueWeeks(store);
      }
      refreshHeader();
    });
  });
}

/** Escape an exercise id for use inside a CSS attribute selector. */
function cssId(id: string): string {
  return id.replace(/["\\]/g, '\\$&');
}

/** Add / remove the little 🔗 badge that marks a box its twin ticked. */
function markTwin(box: HTMLElement | null | undefined, on: boolean): void {
  if (!box) return;
  const existing = box.querySelector('.twin');
  if (on && !existing) {
    const mark = document.createElement('span');
    mark.className = 'twin';
    mark.textContent = '🔗';
    mark.setAttribute('aria-hidden', 'true');
    box.appendChild(mark);
  } else if (!on && existing) {
    existing.remove();
  }
}

/**
 * Fly-ups for the XP split + one combined toast for PR / level-ups.
 *
 * A superset celebrates BOTH exercises from the one ✓ that was tapped: the
 * tapped exercise's parts in the usual green, the partner's in violet, so the
 * numbers say plainly that two exercises were just paid for.
 */
function celebrateSet(
  anchor: Element,
  tappedId: string,
  grants: readonly { ex: Exercise; grant: GrantResult }[],
): void {
  const lines: { text: string; cls?: string }[] = [];
  const notes: string[] = [];
  for (const { ex, grant } of grants) {
    if (grant.xp <= 0) continue; // already granted (re-check) — never pay twice
    for (const p of grant.parts) {
      const text = `+${fmtXp(p.amount)} XP ${BODY_PART_HE[p.part]}!`;
      lines.push(ex.id === tappedId ? { text } : { text, cls: 'ss' });
    }
    if (grant.pr) notes.push(`🏆 שיא חדש ב${ex.he} · XP כפול!`);
    for (const lu of grant.levelUps) {
      notes.push(`🎉 ${BODY_PART_HE[lu.part]} עלה לרמה ${lu.to}!`);
      queuePartPulse(lu.part);
    }
  }
  if (lines.length > 0) flyXp(anchor, lines);
  if (notes.length > 0) toast(notes.join(' · '));
}

/**
 * The legacy app had no explicit "finish workout" action, so we derive it:
 * the first moment every set of every exercise of the day is checked, we emit a
 * single `workout_finished` event and grant the completion bonus (flat XP to
 * every body part + bonus battle energy). Guarded twice — by the event log here
 * and by `game.bonusDays` inside the engine — so it can only pay once per date.
 */
function maybeFinishWorkout(
  store: DataStore,
  view: DayKey,
  date: string,
  anchor: Element,
  program: ResolvedProgram,
): void {
  if (!isWorkoutComplete(store.getState(), view, date, program)) return;
  const already = store.getEvents().some((e) => e.type === 'workout_finished' && e.payload['date'] === date);
  if (already) return;
  store.append('workout_finished', { date, day: view });

  const grant = onWorkoutFinished(store, { date, day: view });
  if (grant.xp <= 0) return;
  const perPart = grant.parts[0]?.amount ?? 0;
  flyXp(anchor, [`אימון הושלם! +${fmtXp(perPart)} XP לכל הגוף`]);
  toast(`💪 אימון הושלם! +${fmtXp(perPart)} XP לכל חלקי הגוף · +${fmtXp(grant.energy)} ⚡ אנרגיית קרב`);
  for (const lu of grant.levelUps) queuePartPulse(lu.part);
}
