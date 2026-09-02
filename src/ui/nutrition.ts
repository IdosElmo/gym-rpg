/**
 * ui/nutrition.ts — the 🍽️ תזונה screen: the meal tracker.
 *
 * A TRACKER, NOT A GAME SCREEN: nothing here grants XP, energy or coins — the
 * cards read `state.nutrition` and the drivers in core/nutrition.ts append
 * tracker events (`meal_logged` / `meal_deleted` / `nutrition_targets_set`)
 * that the game reducer never sees.
 *
 * THE ✨ GEMINI BUTTON IS ABSENT, NOT DISABLED. `deps.ai` arrives only from a
 * build whose composition root wired the Supabase Edge Function port, and the
 * button renders only while `ai.configured()` (= signed in). Everything else on
 * the screen — logging, deleting, targets, history — is fully offline.
 *
 * GEMINI SUGGESTS, NEVER WRITES: an estimate only PREFILLS the calories/protein
 * fields (by poking the live inputs — no re-render, so nothing typed is lost);
 * the meal enters the log exclusively through the הוספה button. If the numbers
 * are still the model's when the user saves, the meal is stamped with its
 * source + confidence for the 🤖 marker; edit either number and it is yours —
 * `manual` again.
 */

import { fmtDate, todayISO } from '../core/workout.ts';
import {
  MEAL_MAX_CALORIES,
  MEAL_MAX_PROTEIN,
  dayTotals,
  deleteMeal,
  logMeal,
  mealsForDate,
  recentDays,
  setTargets,
  shiftDate,
  type MealInput,
  type MealRow,
} from '../core/nutrition.ts';
import type { EstimateError, MealEstimate, NutritionAiPort } from '../nutrition/aiPort.ts';
import { downscalePhoto } from '../nutrition/photo.ts';
import type { DataStore, MealSource, NutritionState, NutritionTargets } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';

export interface NutritionDeps {
  store: DataStore;
  /** Repaint header + main in place (no scroll reset). Absent in bare tests. */
  rerender?: () => void;
  /** The estimation port. Absent = the ✨ button does not exist. */
  ai?: NutritionAiPort;
  /** Injectable for tests. */
  today?: string;
}

/** One Hebrew line per way an estimate can fail. */
export const ESTIMATE_ERROR_HE: Readonly<Record<EstimateError, string>> = {
  signed_out: 'הערכת קלוריות דורשת התחברות לחשבון (במסך ההגדרות) — או הזנה ידנית.',
  offline: 'אין חיבור לאינטרנט — אפשר להזין קלוריות ידנית.',
  rate_limited: 'יותר מדי בקשות — נסו שוב בעוד רגע.',
  http: 'השרת לא ענה — נסו שוב.',
  unparseable: 'לא הצלחנו להבין את התשובה — נסו לנסח אחרת או להזין ידנית.',
};

export const CONFIDENCE_HE: Readonly<Record<MealEstimate['confidence'], string>> = {
  low: 'נמוך',
  medium: 'בינוני',
  high: 'גבוה',
};

/* -------------------------------------------------------- screen-local state */

/** The day on screen; `null` = today. In memory only, like a hub's last tab. */
let viewDate: string | null = null;
/** A photo attached and downscaled, waiting for ✨ (or discarded). */
let photo: { mimeType: string; base64: string } | null = null;
/** The last estimate — so a save whose numbers are untouched keeps its byline. */
let lastEstimate: { estimate: MealEstimate; source: MealSource } | null = null;

/** Forget everything screen-local (tests, and a data wipe). */
export function resetNutritionScreen(): void {
  viewDate = null;
  photo = null;
  lastEstimate = null;
}

/* ------------------------------------------------------------------- html */

function totalsCard(n: NutritionState, date: string): string {
  const t = dayTotals(n, date);
  const g = n.targets;
  return `
  <section class="game-card nt-totals">
    <div class="gc-title">סיכום היום</div>
    <div class="nt-total-row">
      <span class="nt-total">🔥 <b>${t.calories}</b> קלוריות${g.calories !== null ? ` מתוך ${g.calories}` : ''}</span>
      ${bar(t.calories, g.calories)}
    </div>
    <div class="nt-total-row">
      <span class="nt-total">💪 <b>${t.protein}</b> גרם חלבון${g.protein !== null ? ` מתוך ${g.protein}` : ''}</span>
      ${bar(t.protein, g.protein)}
    </div>
    <p class="gc-note dim">${t.meals === 0 ? 'עוד לא תועדו ארוחות ביום הזה' : `${t.meals} ארוחות תועדו`}</p>
  </section>`;
}

function bar(value: number, target: number | null): string {
  if (target === null || target <= 0) return '';
  const pct = Math.min(100, Math.round((value / target) * 100));
  const over = value > target;
  return `<div class="nt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${value}">
    <div class="nt-bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
  </div>`;
}

function mealRowHtml(row: MealRow): string {
  const aiMark = row.ai
    ? `<span class="nt-ai" title="הוערך על ידי ${esc(row.ai.model)} · דיוק ${CONFIDENCE_HE[row.ai.confidence]}">🤖</span>`
    : '';
  return `
  <li class="nt-meal">
    <div class="nt-meal-main">
      <span class="nt-meal-name">${esc(row.name)}</span>${aiMark}
      ${row.time ? `<span class="nt-meal-time dim">${esc(row.time)}</span>` : ''}
    </div>
    <div class="nt-meal-nums">
      <span>🔥 ${row.calories}</span>
      <span>💪 ${row.protein} ג׳</span>
      <button class="nt-del" type="button" data-del="${esc(row.id)}" aria-label="מחיקת ${esc(row.name)}">🗑</button>
    </div>
  </li>`;
}

function mealsCard(n: NutritionState, date: string): string {
  const rows = mealsForDate(n, date);
  const body =
    rows.length === 0
      ? `<p class="empty">לא תועדו ארוחות ביום הזה — הארוחה הראשונה נרשמת למטה 👇</p>`
      : `<ul class="nt-meals">${rows.map(mealRowHtml).join('')}</ul>`;
  return `
  <section class="game-card">
    <div class="gc-title">הארוחות של היום</div>
    ${body}
  </section>`;
}

function addCard(showAi: boolean, date: string, today: string): string {
  const aiRow = showAi
    ? `
    <div class="nt-est-row">
      <button class="action-btn" id="ntEst" type="button">✨ הערכה עם Gemini</button>
      <button class="action-btn ghost" id="ntPhotoBtn" type="button" aria-label="צירוף תמונת ארוחה">📷</button>
      <input type="file" id="ntPhoto" accept="image/*" hidden>
    </div>
    <p class="gc-note" id="ntPhotoNote" hidden>📷 תמונה צורפה <button class="nt-photo-clear" id="ntPhotoClear" type="button">הסרה</button></p>
    <p class="gc-note" id="ntEstMsg" role="status"></p>`
    : '';
  // On a past day the card says WHERE the meal will land — a forgotten dinner
  // is logged onto yesterday, not silently onto today.
  const dayNote = date === today ? '' : ` <span class="gc-sub">ליום ${esc(fmtDate(date))}</span>`;
  return `
  <section class="game-card nt-add">
    <div class="gc-title">הוספת ארוחה${dayNote}</div>
    <label class="nt-field">תיאור הארוחה
      <textarea class="inp nt-textarea" id="ntName" rows="3" maxlength="300" autocomplete="off"
        placeholder="למשל: טוסט עם 2 פרוסות גבינה צהובה וקופסת טונה אחת — ככל שהתיאור מפורט יותר (כמויות, אופן הכנה), ההערכה מדויקת יותר"></textarea>
    </label>
    ${aiRow}
    <div class="nt-field-row">
      <label class="nt-field">קלוריות
        <input class="inp" id="ntCal" type="text" inputmode="numeric" autocomplete="off" placeholder="0">
      </label>
      <label class="nt-field">חלבון (גרם)
        <input class="inp" id="ntProt" type="text" inputmode="numeric" autocomplete="off" placeholder="0">
      </label>
      <label class="nt-field">שעה
        <input class="inp" id="ntTime" type="time">
      </label>
    </div>
    <button class="action-btn" id="ntAdd" type="button">הוספה</button>
    <p class="gc-note" id="ntAddMsg" role="status"></p>
  </section>`;
}

function weekCard(n: NutritionState, today: string): string {
  const days = recentDays(n, today, 7);
  const rows = days
    .map(
      (d) => `
    <li class="nt-day ${d.date === today ? 'today' : ''}">
      <span class="nt-day-date">${esc(fmtDate(d.date))}</span>
      <span class="nt-day-nums">🔥 ${d.calories} · 💪 ${d.protein} ג׳</span>
    </li>`,
    )
    .join('');
  return `
  <section class="game-card">
    <div class="gc-title">השבוע האחרון</div>
    <ul class="nt-week">${rows}</ul>
  </section>`;
}

function targetsCard(targets: NutritionTargets): string {
  return `
  <section class="game-card nt-targets">
    <div class="gc-title">יעדים יומיים <span class="gc-sub">לא חובה</span></div>
    <div class="nt-field-row">
      <label class="nt-field">קלוריות ליום
        <input class="inp" id="ntTgtCal" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.calories ?? ''}" placeholder="—">
      </label>
      <label class="nt-field">חלבון ליום (גרם)
        <input class="inp" id="ntTgtProt" type="text" inputmode="numeric" autocomplete="off"
          value="${targets.protein ?? ''}" placeholder="—">
      </label>
    </div>
    <button class="action-btn" id="ntTgtSave" type="button">שמירת יעדים</button>
    <p class="gc-note" id="ntTgtMsg" role="status"></p>
  </section>`;
}

function dayNav(date: string, today: string): string {
  return `
  <div class="nt-daynav">
    <button class="action-btn ghost" id="ntPrev" type="button">→ יום אחורה</button>
    <span class="nt-date"><b>${date === today ? 'היום' : esc(fmtDate(date))}</b></span>
    <button class="action-btn ghost" id="ntNext" type="button" ${date === today ? 'disabled' : ''}>יום קדימה ←</button>
  </div>`;
}

/** The whole screen as a string — pure, testable without a DOM. */
export function nutritionHtml(n: NutritionState, date: string, today: string, showAi: boolean): string {
  return `
  ${dayNav(date, today)}
  ${totalsCard(n, date)}
  ${mealsCard(n, date)}
  ${addCard(showAi, date, today)}
  ${weekCard(n, today)}
  ${targetsCard(n.targets)}`;
}

/* ----------------------------------------------------------------- render */

export function renderNutrition(main: HTMLElement, deps: NutritionDeps): void {
  const today = deps.today ?? todayISO();
  if (viewDate !== null && viewDate > today) viewDate = null;
  const date = viewDate ?? today;
  const showAi = deps.ai?.configured() === true;
  main.innerHTML = nutritionHtml(deps.store.getState().nutrition, date, today, showAi);
  wire(main, deps, date, today);
}

function refresh(main: HTMLElement, deps: NutritionDeps): void {
  if (deps.rerender) deps.rerender();
  else renderNutrition(main, deps);
}

/* ----------------------------------------------------------------- wiring */

/** The wall clock as 'HH:MM' — display data, so the UI may read the clock. */
function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function intOf(input: HTMLInputElement | null, max: number): number | null {
  const raw = (input?.value ?? '').trim();
  if (raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), max);
}

function wire(main: HTMLElement, deps: NutritionDeps, date: string, today: string): void {
  const again = (): void => refresh(main, deps);

  /* ---- day navigation ---- */
  main.querySelector<HTMLButtonElement>('#ntPrev')?.addEventListener('click', () => {
    viewDate = shiftDate(date, -1);
    again();
  });
  main.querySelector<HTMLButtonElement>('#ntNext')?.addEventListener('click', () => {
    const next = shiftDate(date, 1);
    viewDate = next >= today ? null : next;
    again();
  });

  /* ---- delete a meal ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['del'];
      if (!id) return;
      if (!confirm('למחוק את הארוחה? הרישום יוסר מהסיכום היומי.')) return;
      deleteMeal(deps.store, id);
      again();
    });
  });

  /* ---- add a meal ---- */
  const nameInp = main.querySelector<HTMLTextAreaElement>('#ntName');
  const calInp = main.querySelector<HTMLInputElement>('#ntCal');
  const protInp = main.querySelector<HTMLInputElement>('#ntProt');
  const timeInp = main.querySelector<HTMLInputElement>('#ntTime');
  const addMsg = main.querySelector<HTMLElement>('#ntAddMsg');

  main.querySelector<HTMLButtonElement>('#ntAdd')?.addEventListener('click', () => {
    const name = (nameInp?.value ?? '').trim();
    const calories = intOf(calInp, MEAL_MAX_CALORIES);
    const protein = intOf(protInp, MEAL_MAX_PROTEIN);
    if (!name) {
      if (addMsg) addMsg.textContent = 'לארוחה צריך תיאור — גם מילה אחת מספיקה.';
      return;
    }
    if (calories === null || protein === null) {
      if (addMsg) addMsg.textContent = 'קלוריות וחלבון צריכים להיות מספרים.';
      return;
    }
    // The estimate's byline survives only while its numbers do.
    const est = lastEstimate;
    const fromAi = est !== null && est.estimate.calories === calories && est.estimate.proteinG === protein;
    const typedTime = timeInp?.value && /^\d{2}:\d{2}$/.test(timeInp.value) ? timeInp.value : '';
    const input: MealInput = {
      date,
      name,
      calories,
      protein,
      // No time typed: on TODAY the meal is stamped "now" — logging right after
      // eating is the common case. On a past day "now" would be a lie, so the
      // time stays empty unless the user says otherwise.
      time: typedTime !== '' ? typedTime : date === today ? nowHHMM() : '',
      source: fromAi ? est.source : 'manual',
      ...(fromAi
        ? { ai: { model: 'gemini', confidence: est.estimate.confidence, items: est.estimate.items } }
        : {}),
    };
    const ev = logMeal(deps.store, input, crypto.randomUUID());
    if (!ev) {
      if (addMsg) addMsg.textContent = 'לא הצלחנו לרשום את הארוחה — בדקו את הפרטים.';
      return;
    }
    lastEstimate = null;
    photo = null;
    toast('הארוחה נרשמה 🍽️');
    again();
  });

  /* ---- targets ---- */
  const tgtMsg = main.querySelector<HTMLElement>('#ntTgtMsg');
  main.querySelector<HTMLButtonElement>('#ntTgtSave')?.addEventListener('click', () => {
    const calRaw = (main.querySelector<HTMLInputElement>('#ntTgtCal')?.value ?? '').trim();
    const protRaw = (main.querySelector<HTMLInputElement>('#ntTgtProt')?.value ?? '').trim();
    const cal = calRaw === '' ? null : Number(calRaw);
    const prot = protRaw === '' ? null : Number(protRaw);
    if ((cal !== null && (!Number.isFinite(cal) || cal < 0)) || (prot !== null && (!Number.isFinite(prot) || prot < 0))) {
      if (tgtMsg) tgtMsg.textContent = 'היעדים צריכים להיות מספרים (או ריקים).';
      return;
    }
    setTargets(deps.store, {
      calories: cal === null ? null : Math.floor(cal),
      protein: prot === null ? null : Math.floor(prot),
    });
    toast('היעדים נשמרו');
    again();
  });

  /* ---- Gemini estimation (only rendered when the port says configured) ---- */
  const ai = deps.ai;
  const estBtn = main.querySelector<HTMLButtonElement>('#ntEst');
  const estMsg = main.querySelector<HTMLElement>('#ntEstMsg');
  const photoNote = main.querySelector<HTMLElement>('#ntPhotoNote');
  const photoInp = main.querySelector<HTMLInputElement>('#ntPhoto');

  const showPhotoNote = (): void => {
    if (photoNote) photoNote.hidden = photo === null;
  };
  showPhotoNote();

  main.querySelector<HTMLButtonElement>('#ntPhotoBtn')?.addEventListener('click', () => photoInp?.click());
  main.querySelector<HTMLButtonElement>('#ntPhotoClear')?.addEventListener('click', () => {
    photo = null;
    if (photoInp) photoInp.value = '';
    showPhotoNote();
  });
  photoInp?.addEventListener('change', () => {
    const file = photoInp.files?.[0];
    if (!file) return;
    void downscalePhoto(file)
      .then((p) => {
        photo = p;
        showPhotoNote();
      })
      .catch(() => {
        if (estMsg) estMsg.textContent = 'לא הצלחנו לקרוא את התמונה — נסו תמונה אחרת.';
      });
  });

  if (ai && estBtn) {
    estBtn.addEventListener('click', () => {
      const text = (nameInp?.value ?? '').trim();
      if (!text && !photo) {
        if (estMsg) estMsg.textContent = 'כתבו תיאור קצר או צרפו תמונה — ואז ✨.';
        return;
      }
      estBtn.disabled = true;
      const label = estBtn.textContent;
      estBtn.textContent = 'מעריך…';
      if (estMsg) estMsg.textContent = '';
      void ai
        .estimate({ text, ...(photo ? { photo } : {}) })
        .then((result) => {
          if (!result.ok) {
            if (estMsg) estMsg.textContent = ESTIMATE_ERROR_HE[result.error];
            return;
          }
          const est = result.estimate;
          lastEstimate = { estimate: est, source: photo ? 'gemini_photo' : 'gemini_text' };
          // Prefill by poking the LIVE inputs — no re-render, nothing typed is lost.
          if (calInp) calInp.value = String(est.calories);
          if (protInp) protInp.value = String(est.proteinG);
          if (estMsg) {
            const found = est.items.length > 0 ? `נמצא: ${est.items.join(', ')} · ` : '';
            // Anything short of high confidence says WHY, so the user knows what
            // to add to the description (a quantity, a preparation) and retry.
            const why = est.confidence !== 'high' && est.reason ? ` (${est.reason})` : '';
            estMsg.textContent = `${found}דיוק ${CONFIDENCE_HE[est.confidence]}${why} — אפשר לתקן לפני ההוספה.`;
          }
        })
        .finally(() => {
          estBtn.disabled = false;
          estBtn.textContent = label;
        });
    });
  }
}
