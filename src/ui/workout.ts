/**
 * ui/workout.ts — the workout screen (exercise cards + set logging).
 *
 * A 1:1 port of the legacy render: order badge, Hebrew + English titles, muscle
 * / scheme / equipment badges, a collapsible "הסבר ודגשי ביצוע" panel with the
 * numbered steps + cue + common-mistake blocks, the 3-column log table with
 * previous-performance hints, the rest hint, and the green `done-all` state.
 *
 * All writes go through the `DataStore` — this module never touches storage.
 */

import { PROGRAM, equipHe, type DayKey, type Exercise } from '../data/program.ts';
import {
  doneCount,
  getSetData,
  isWorkoutComplete,
  prevPerf,
  todayISO,
} from '../core/workout.ts';
import type { DataStore } from '../storage/DataStore.ts';
import type { RestTimer } from './timer.ts';
import { esc } from './dom.ts';

export interface WorkoutDeps {
  store: DataStore;
  timer: RestTimer;
  /** Re-render the header only (last-logged date can change on every keystroke). */
  refreshHeader: () => void;
}

export function renderWorkout(main: HTMLElement, view: DayKey, deps: WorkoutDeps): void {
  const { store } = deps;
  const state = store.getState();
  const p = PROGRAM[view];
  const today = todayISO();

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
      return `
    <section class="ex-card ${open} ${allDone}" id="card-${esc(ex.id)}">
      <div class="ex-head">
        <div class="ex-order">תרגיל ${idx + 1} / ${p.exercises.length}</div>
        <h2 class="ex-title">${ex.he}</h2>
        <div class="ex-title-en">${ex.en}</div>
        <div class="badges">
          <span class="badge muscle">🎯 ${ex.muscle}</span>
          <span class="badge scheme">${ex.sets} סטים × ${ex.reps}</span>
          ${ex.equip.map((e) => `<span class="badge equip">${equipHe(e)}</span>`).join('')}
        </div>
      </div>
      <button class="form-toggle" data-toggle="${esc(ex.id)}">
        <span>הסבר ודגשי ביצוע</span><span class="chev">▾</span>
      </button>
      <div class="form-panel">
        <h4>שלבי ביצוע</h4>
        <ol>${ex.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
        <div class="cue">💡 <b>דגש:</b> ${ex.cue}</div>
        <div class="mistake">⚠️ ${ex.mistake}</div>
      </div>
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

  bind(main, view, deps, today);
}

function findEx(view: DayKey, exId: string): Exercise | undefined {
  return PROGRAM[view].exercises.find((e) => e.id === exId);
}

function bind(main: HTMLElement, view: DayKey, deps: WorkoutDeps, today: string): void {
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
      const ex = findEx(view, exId);
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
        maybeFinishWorkout(store, view, today);
      }
      refreshHeader();
    });
  });
}

/**
 * The legacy app had no explicit "finish workout" action, so we derive it:
 * the first moment every set of every exercise of the day is checked, we emit a
 * single `workout_finished` event (Phase 1 hangs the completion XP/energy bonus
 * off it). Guarded so it can only fire once per date.
 */
function maybeFinishWorkout(store: DataStore, view: DayKey, date: string): void {
  if (!isWorkoutComplete(store.getState(), view, date)) return;
  const already = store.getEvents().some((e) => e.type === 'workout_finished' && e.payload['date'] === date);
  if (already) return;
  store.append('workout_finished', { date, day: view });
}
