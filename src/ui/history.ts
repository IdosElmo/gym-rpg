/**
 * ui/history.ts — the היסטוריה screen (view `H`), second inner tab of the
 * settings hub: the game-event feed (see ui/feed.ts) and the logged-workout
 * history, and nothing else.
 *
 * The account card, the plan card and export / import / clear used to sit on
 * top of this list. They moved one tab across, to ui/settings.ts — they are
 * things you PRESS, this is a thing you READ, and the screen was the only place
 * in the app where those two lived in the same scroll. What is left here is the
 * record of what actually happened: every workout, newest first, plus the
 * adventure feed that narrates it.
 */

import { dayLabelOf, dayOf } from '../data/program.ts';
import { fmtDate, isSetFilled } from '../core/workout.ts';
import { makeResolver, resolveProgram } from '../core/plan.ts';
import type { DataStore } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { renderFeed } from './feed.ts';

export interface HistoryDeps {
  store: DataStore;
}

export function renderHistory(main: HTMLElement, deps: HistoryDeps): void {
  const state = deps.store.getState();
  const dates = Object.keys(state.sessions).sort().reverse();
  const program = resolveProgram(state.plan);
  // History shows exercises BY ID, long after a plan may have changed — so it
  // resolves through the plan (customs included) and still tolerates an id that
  // resolves to nothing at all.
  const resolve = makeResolver(state.plan);

  let html = `
  ${renderFeed(deps.store.getEvents(), 40, resolve, (key) => dayLabelOf(program, key))}
  <h2 class="hist-heading">אימונים מתועדים</h2>`;

  const nonEmpty = dates.filter((d) => Object.keys(state.sessions[d]?.ex ?? {}).length > 0);
  if (nonEmpty.length === 0) {
    html += `<div class="empty">עדיין אין אימונים מתועדים.<br>סמנו סטים באחד מימי האימון והם יופיעו כאן. 💪</div>`;
  } else {
    html += nonEmpty
      .map((date) => {
        const s = state.sessions[date];
        if (!s) return '';
        // History is shown by DAY KEY, long after a plan may have dropped that
        // day. `dayLabelOf` names it anyway (the plan's label, then the built-in
        // one for a legacy A/B/C session, then a neutral "אימון"); the weekday
        // caption and the focus line only exist while the day itself does, and
        // are simply left out rather than borrowed from some other day.
        const p = dayOf(program, s.day);
        const label = dayLabelOf(program, s.day);
        const exHtml = Object.keys(s.ex)
          .map((exId) => {
            const exDef = resolve(exId);
            const sets = (s.ex[exId] ?? []).filter((x) => isSetFilled(x));
            if (!sets.length) return '';
            const setsTxt = sets
              .map((x) => `${x && x.w !== '' ? esc(x.w) : '–'}kg×${x && x.r !== '' ? esc(x.r) : '–'}${x && x.done ? '✓' : ''}`)
              .join('  |  ');
            return `<div class="hist-ex"><b>${esc(exDef ? exDef.he : exId)}</b><br><span class="hist-sets">${setsTxt}</span></div>`;
          })
          .join('');
        if (!exHtml) return '';
        const title = ` · ${esc(label)}${p ? ` (יום ${esc(p.day)})` : ''}`;
        return `<div class="hist-day">
        <h3>${fmtDate(date)}${title}</h3>
        <div class="sub">${p ? esc(p.focus) : ''}</div>
        ${exHtml}
      </div>`;
      })
      .join('');
  }

  main.innerHTML = html;
}
