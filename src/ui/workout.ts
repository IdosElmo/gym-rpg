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
 */

import {
  BODY_PART_HE,
  dayOf,
  equipHe,
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
import { resolveProgram } from '../core/plan.ts';
import { onSetCompleted, onWorkoutFinished, type GrantResult } from '../core/game.ts';
import type { DataStore } from '../storage/DataStore.ts';
import type { RestTimer } from './timer.ts';
import { queuePartPulse } from './character.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { flyXp, fmtXp } from './xpfx.ts';

export interface WorkoutDeps {
  store: DataStore;
  timer: RestTimer;
  /** Re-render the header only (last-logged date can change on every keystroke). */
  refreshHeader: () => void;
}

export function renderWorkout(main: HTMLElement, view: DayKey, deps: WorkoutDeps): void {
  const { store } = deps;
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

  main.innerHTML = p.exercises
    .map((ex, idx) => {
      const prev = prevPerf(state, ex.id, today);
      const rows: string[] = [];
      let done = 0;
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
            (pw !== '' ? esc(pw) + ' ק"ג' : '') +
            (pw !== '' && pr !== '' ? ' × ' : '') +
            (pr !== '' ? esc(pr) : '');
        }
        rows.push(`
      <div class="log-row ${d.done ? 'checked' : ''}">
        <div class="set-num">${i + 1}</div>
        <div class="inp-wrap">
          <input class="inp" type="number" inputmode="decimal" step="0.5" min="0" placeholder='ק"ג'
            value="${esc(d.w)}" data-ex="${esc(ex.id)}" data-set="${i}" data-f="w">
          <span class="prev">${prevTxt}</span>
        </div>
        <div class="inp-wrap">
          <input class="inp" type="number" inputmode="numeric" min="0" placeholder="${esc(ex.unit)}"
            value="${esc(d.r)}" data-ex="${esc(ex.id)}" data-set="${i}" data-f="r">
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
          <span class="badge muscle">🎯 ${esc(ex.muscle)}</span>
          <span class="badge scheme">${ex.sets} סטים × ${esc(ex.reps)}</span>
          ${ex.equip.map((e) => `<span class="badge equip">${esc(equipHe(e))}</span>`).join('')}
        </div>
      </div>
      ${guide}
      <div class="log">
        <div class="log-row head">
          <div style="text-align:center">סט</div><div style="text-align:center">משקל (ק"ג)</div>
          <div style="text-align:center">${ex.unit}</div><div style="text-align:center">✓</div>
        </div>
        ${rows.join('')}
        <div class="rest-hint">⏱ מנוחה מומלצת: ${ex.rest} שניות (מתחיל אוטומטית בסימון סט)</div>
      </div>
    </section>`;
    })
    .join('');

  bind(main, view, deps, today, program);
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
): void {
  const { store, timer, refreshHeader } = deps;

  main.querySelectorAll<HTMLButtonElement>('.form-toggle').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset['toggle'];
      if (!id) return;
      store.update((draft) => {
        draft.ui.open[id] = !draft.ui.open[id];
      });
      b.closest('.ex-card')?.classList.toggle('open');
    });
  });

  main.querySelectorAll<HTMLInputElement>('.inp').forEach((inp) => {
    inp.addEventListener('input', () => {
      const exId = inp.dataset['ex'];
      const field = inp.dataset['f'];
      const i = Number(inp.dataset['set']);
      if (!exId || (field !== 'w' && field !== 'r') || !Number.isInteger(i)) return;
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

  main.querySelectorAll<HTMLButtonElement>('.chk').forEach((btn) => {
    btn.addEventListener('click', () => {
      const exId = btn.dataset['ex'];
      const i = Number(btn.dataset['set']);
      if (!exId || !Number.isInteger(i)) return;
      const ex = findEx(program, view, exId);
      if (!ex) return;

      let nowDone = false;
      let w = '';
      let r = '';
      store.update((draft) => {
        const d = getSetData(draft, view, exId, i, true, today);
        if (!d) return;
        d.done = !d.done;
        nowDone = d.done;
        w = d.w;
        r = d.r;
      });

      store.append(nowDone ? 'set_completed' : 'set_uncompleted', {
        date: today,
        day: view,
        exId,
        setIndex: i,
        w,
        r,
      });

      const row = btn.closest('.log-row');
      btn.classList.toggle('on', nowDone);
      row?.classList.toggle('checked', nowDone);

      const state = store.getState();
      const card = document.getElementById('card-' + exId);
      card?.classList.toggle('done-all', doneCount(state, exId, today) === ex.sets);

      if (nowDone) {
        timer.start(ex.rest, `${ex.he} · סט ${i + 1} הושלם`);
        const grant = onSetCompleted(store, { date: today, day: view, ex, setIndex: i, w, r });
        celebrateSet(btn, ex, grant);
        maybeFinishWorkout(store, view, today, btn, program);
      }
      refreshHeader();
    });
  });
}

/** Fly-ups for the XP split + one combined toast for PR / level-ups. */
function celebrateSet(anchor: Element, ex: Exercise, grant: GrantResult): void {
  if (grant.xp <= 0) return; // already granted (re-check) — never pay twice
  flyXp(
    anchor,
    grant.parts.map((p) => `+${fmtXp(p.amount)} XP ${BODY_PART_HE[p.part]}!`),
  );

  const notes: string[] = [];
  if (grant.pr) notes.push(`🏆 שיא חדש ב${ex.he} · XP כפול!`);
  for (const lu of grant.levelUps) {
    notes.push(`🎉 ${BODY_PART_HE[lu.part]} עלה לרמה ${lu.to}!`);
    queuePartPulse(lu.part);
  }
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
