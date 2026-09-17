/**
 * ui/photos.ts — the 📸 תמונות screen (view `PH`), the nutrition hub's third
 * inner tab: progress photos, a gallery of them, and a viewer.
 *
 * A TRACKER, NOT A GAME SCREEN, like its two siblings: nothing here grants
 * XP, energy or coins. The cards read `state.nutrition.photos` and the
 * drivers in core/photos.ts append the tracker events; the PIXELS go through
 * `deps.blobs` (the BlobStore) and never touch the log. Fully offline, and
 * fully LOCAL — the sync engine skips photo events, and the screen says so.
 *
 * TWO POSES, ONE GHOST EACH. The fixed pose (חזית) and the user's own; the
 * new-photo card shows the newest photo of the chosen pose beside the button,
 * so the next shot can be framed like the last one. (Phase 4 puts that ghost
 * over a live camera; here it is a thumbnail beside a file picker, which on a
 * phone offers the camera anyway.)
 *
 * IMAGES ARRIVE AFTER THE HTML. The screen renders as a string like every
 * other, with an empty <img> per tile; `hydrate` then fetches each blob and
 * points the tile at an object URL. URLs are cached per photo id for the
 * life of the screen and revoked on `resetPhotosScreen` (a wipe, tests) or
 * when the photo is deleted — never per render, so scrolling the gallery
 * does not re-decode every thumbnail.
 */

import { fmtDate, todayISO } from '../core/workout.ts';
import {
  PHOTO_MAX_DIM,
  PHOTO_MAX_NOTE_LEN,
  POSE_NAME_MAX_LEN,
  deletePhoto,
  latestPhoto,
  namePose,
  photoBytes,
  photoEntries,
  poseLabel,
  recordPhoto,
  weightForDate,
  type PhotoRow,
} from '../core/photos.ts';
import { preparePhoto, type PreparedPhoto } from '../nutrition/photo.ts';
import type { BlobStore, DataStore, NutritionState, PhotoPose } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { fmtKg } from './weight.ts';

export interface PhotosDeps {
  store: DataStore;
  /** Where the bytes live. */
  blobs: BlobStore;
  /** Repaint header + main in place (no scroll reset). Absent in bare tests. */
  rerender?: () => void;
  /** How a picked file becomes a stored image. Injectable: jsdom has no canvas. */
  prepare?: (file: File, maxDim: number) => Promise<PreparedPhoto>;
  /** Injectable for tests. */
  today?: string;
}

/* -------------------------------------------------------- screen-local state */

export type PoseFilter = 'all' | PhotoPose;

/** The pose the next photo is taken in. */
let shootPose: PhotoPose = 'front';
/** Which photos the gallery lists. */
let filter: PoseFilter = 'all';
/** The photo open in the viewer, or `null`. */
let viewerId: string | null = null;
/** Object URLs by photo id — created once, revoked on reset or delete. */
const urls = new Map<string, string>();

function revoke(id: string): void {
  const u = urls.get(id);
  if (u !== undefined) {
    urls.delete(id);
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* not a real object URL (tests) */
    }
  }
}

/** Forget everything screen-local (tests, and a data wipe). */
export function resetPhotosScreen(): void {
  shootPose = 'front';
  filter = 'all';
  viewerId = null;
  for (const id of [...urls.keys()]) revoke(id);
}

/* ------------------------------------------------------------- formatting */

/** "1.2 MB" / "340 KB" — for the storage tally. */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The header's one line under the title. */
export function photosHeadline(n: NutritionState): string {
  const rows = photoEntries(n);
  if (rows.length === 0) return 'עוד אין תמונות התקדמות — הראשונה נרשמת במסך הזה';
  const last = rows[rows.length - 1];
  return `${rows.length} תמונות · האחרונה ${last ? fmtDate(last.date) : ''} · נשמרות במכשיר בלבד`;
}

/** The fixed pose's how-to, shown before its first photo. */
const FRONT_HOWTO = 'עמידה רגועה מול המצלמה, ידיים לצדי הגוף, כל הגוף בפריים, אותו מקום ואותה תאורה בכל פעם.';

/* ------------------------------------------------------------------- html */

function poseSeg(n: NutritionState, active: PhotoPose | PoseFilter, attr: 'pose' | 'filter', withAll: boolean): string {
  const items: { key: PoseFilter; label: string }[] = [
    ...(withAll ? [{ key: 'all' as const, label: 'הכל' }] : []),
    { key: 'front', label: `🧍 ${poseLabel(n, 'front')}` },
    { key: 'custom', label: `⭐ ${poseLabel(n, 'custom')}` },
  ];
  return `<div class="nt-seg-row" role="group" aria-label="${attr === 'pose' ? 'הפוזה' : 'סינון לפי פוזה'}">${items
    .map(
      (it) =>
        `<button class="nt-seg ${it.key === active ? 'active' : ''}" type="button" data-${attr}="${it.key}"
        aria-pressed="${it.key === active ? 'true' : 'false'}">${esc(it.label)}</button>`,
    )
    .join('')}</div>`;
}

/** The caption under a tile / in the viewer: date, time, weight, pose. */
function caption(n: NutritionState, p: PhotoRow): string {
  const kg = weightForDate(n, p.date);
  return `<span class="ph-cap-date">${esc(fmtDate(p.date))}${p.time ? ` <span class="dim">${esc(p.time)}</span>` : ''}</span>
    ${kg !== null ? `<span class="ph-cap-kg">${fmtKg(kg)} ק״ג</span>` : ''}`;
}

function shootCard(n: NutritionState, today: string): string {
  const ghost = latestPhoto(n, shootPose);
  const ghostHtml = ghost
    ? `
    <div class="ph-ghost">
      <div class="ph-thumb ph-ghost-img"><img alt="" data-blob="${esc(ghost.id)}"></div>
      <p class="gc-note">התמונה האחרונה ב${esc(poseLabel(n, shootPose))} — מ־${esc(fmtDate(ghost.date))}.
        צלמו באותו מקום, באותה עמידה ובאותו מרחק, כדי שההשוואה תהיה הוגנת.</p>
    </div>`
    : `<p class="gc-note">${shootPose === 'front' ? `זו התמונה הראשונה בפוזה הזו. ${FRONT_HOWTO}` : 'זו התמונה הראשונה בפוזה שלכם — בחרו עמידה שתוכלו לחזור עליה, והתמונה הזו תהיה הרוח לבאות אחריה.'}</p>`;
  return `
  <section class="game-card ph-shoot">
    <div class="gc-title">תמונה חדשה</div>
    ${poseSeg(n, shootPose, 'pose', false)}
    ${ghostHtml}
    <div class="nt-field-row">
      <label class="nt-field">תאריך
        <input class="inp" id="phDate" type="date" value="${today}" max="${today}">
      </label>
      <label class="nt-field ph-note-field">הערה <span class="gc-sub">לא חובה</span>
        <input class="inp wt-note-inp" id="phNote" type="text" maxlength="${PHOTO_MAX_NOTE_LEN}" autocomplete="off"
          placeholder="למשל: בוקר, אחרי חופשה">
      </label>
    </div>
    <button class="action-btn" id="phPick" type="button">📷 צילום או בחירה מהגלריה</button>
    <input type="file" id="phFile" accept="image/*" hidden>
    <p class="gc-note" id="phMsg" role="status"></p>
    <p class="gc-note dim">🔒 התמונות נשמרות במכשיר הזה בלבד — לא נשלחות לחשבון ולא לשום שרת.</p>
  </section>`;
}

function tile(n: NutritionState, p: PhotoRow): string {
  return `
    <li class="ph-item">
      <button class="ph-tile" type="button" data-open="${esc(p.id)}" aria-label="פתיחת התמונה מ־${esc(fmtDate(p.date))}">
        <span class="ph-thumb"><img alt="" data-blob="${esc(p.id)}"></span>
        <span class="ph-pose ${p.pose}">${p.pose === 'front' ? '🧍' : '⭐'}</span>
      </button>
      <div class="ph-cap">${caption(n, p)}</div>
    </li>`;
}

function galleryCard(n: NutritionState): string {
  const all = photoEntries(n);
  const shown = (filter === 'all' ? all : all.filter((p) => p.pose === filter)).slice().reverse();
  const body =
    all.length === 0
      ? `<p class="empty">עוד אין תמונות — הראשונה נרשמת למעלה 👆</p>`
      : shown.length === 0
        ? `<p class="empty">אין תמונות בפוזה הזו עדיין.</p>`
        : `<ul class="ph-grid">${shown.map((p) => tile(n, p)).join('')}</ul>`;
  return `
  <section class="game-card ph-gallery">
    <div class="gc-title">הגלריה <span class="gc-sub">${all.length === 0 ? '' : `${all.length} תמונות · ${fmtBytes(photoBytes(n))}`}</span></div>
    ${all.length > 0 ? poseSeg(n, filter, 'filter', true) : ''}
    ${body}
    ${all.length > 0 ? `<p class="gc-note dim">החדשה ביותר ראשונה. לחיצה על תמונה פותחת אותה בגדול.</p>` : ''}
  </section>`;
}

function poseNameCard(n: NutritionState): string {
  return `
  <section class="game-card ph-pose-card">
    <div class="gc-title">הפוזה המותאמת <span class="gc-sub">לא חובה</span></div>
    <label class="nt-field">שם לפוזה השנייה
      <input class="inp wt-note-inp" id="phPoseName" type="text" maxlength="${POSE_NAME_MAX_LEN}" autocomplete="off"
        value="${esc(n.customPoseName)}" placeholder="למשל: צד ימין, גב, דאבל בייספס">
    </label>
    <button class="action-btn" id="phPoseSave" type="button">שמירת השם</button>
    <p class="gc-note dim">🧍 חזית היא הפוזה הקבועה; ⭐ היא שלכם. בלי שם היא נקראת "הפוזה שלי".</p>
  </section>`;
}

function viewer(n: NutritionState): string {
  if (viewerId === null) return '';
  const p = photoEntries(n).find((r) => r.id === viewerId);
  if (!p) return '';
  return `
  <div class="ph-viewer" role="dialog" aria-modal="true" aria-label="תמונה מ־${esc(fmtDate(p.date))}">
    <div class="ph-viewer-bar">
      <button class="ph-vbtn" type="button" id="phClose" aria-label="סגירה">✕</button>
      <span class="ph-viewer-title">${esc(poseLabel(n, p.pose))}</span>
      <button class="ph-vbtn danger" type="button" data-del="${esc(p.id)}" aria-label="מחיקת התמונה">🗑</button>
    </div>
    <div class="ph-viewer-img"><img alt="תמונת התקדמות מ־${esc(fmtDate(p.date))}" data-blob="${esc(p.id)}"></div>
    <div class="ph-viewer-cap">
      ${caption(n, p)}
      ${p.note ? `<span class="ph-cap-note">${esc(p.note)}</span>` : ''}
      <span class="dim">${p.width}×${p.height} · ${fmtBytes(p.bytes)}</span>
    </div>
  </div>`;
}

/** The whole screen as a string — pure, testable without a DOM. */
export function photosHtml(n: NutritionState, today: string): string {
  return `
  ${shootCard(n, today)}
  ${galleryCard(n)}
  ${poseNameCard(n)}
  ${viewer(n)}`;
}

/* ----------------------------------------------------------------- render */

export function renderPhotos(main: HTMLElement, deps: PhotosDeps): void {
  const today = deps.today ?? todayISO();
  const n = deps.store.getState().nutrition;
  main.innerHTML = photosHtml(n, today);
  wire(main, deps, today);
  void hydrate(main, deps.blobs);
}

function refresh(main: HTMLElement, deps: PhotosDeps): void {
  if (deps.rerender) deps.rerender();
  else renderPhotos(main, deps);
}

/** Point every `[data-blob]` image at its bytes; mark the ones the store lacks. */
async function hydrate(main: HTMLElement, blobs: BlobStore): Promise<void> {
  const imgs = [...main.querySelectorAll<HTMLImageElement>('img[data-blob]')];
  await Promise.all(
    imgs.map(async (img) => {
      const id = img.dataset['blob'];
      if (!id) return;
      let url = urls.get(id);
      if (url === undefined) {
        const blob = await blobs.get(id).catch(() => null);
        if (blob && typeof URL.createObjectURL === 'function') {
          url = URL.createObjectURL(blob);
          urls.set(id, url);
        }
      }
      if (!img.isConnected) return;
      if (url) {
        img.src = url;
        img.classList.add('ready');
      } else {
        img.closest('.ph-thumb, .ph-viewer-img')?.classList.add('missing');
      }
    }),
  );
}

/* ----------------------------------------------------------------- wiring */

/** The wall clock as 'HH:MM' — display data, so the UI may read the clock. */
function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function wire(main: HTMLElement, deps: PhotosDeps, today: string): void {
  const again = (): void => refresh(main, deps);
  const n = deps.store.getState().nutrition;

  /* ---- pose to shoot in, gallery filter ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((btn) => {
    btn.addEventListener('click', () => {
      shootPose = btn.dataset['pose'] === 'custom' ? 'custom' : 'front';
      again();
    });
  });
  main.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.dataset['filter'];
      filter = f === 'front' || f === 'custom' ? f : 'all';
      again();
    });
  });

  /* ---- take / pick a photo ---- */
  const fileInp = main.querySelector<HTMLInputElement>('#phFile');
  const msg = main.querySelector<HTMLElement>('#phMsg');
  const pick = main.querySelector<HTMLButtonElement>('#phPick');
  pick?.addEventListener('click', () => fileInp?.click());
  fileInp?.addEventListener('change', () => {
    const file = fileInp.files?.[0];
    if (!file) return;
    const date = (main.querySelector<HTMLInputElement>('#phDate')?.value ?? '').trim() || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
      if (msg) msg.textContent = 'התאריך לא תקין — ותמונה לא יכולה להיות מהעתיד.';
      fileInp.value = '';
      return;
    }
    const note = (main.querySelector<HTMLInputElement>('#phNote')?.value ?? '').trim();
    const pose = shootPose;
    if (pick) {
      pick.disabled = true;
      pick.textContent = 'שומר…';
    }
    const prepare = deps.prepare ?? preparePhoto;
    void prepare(file, PHOTO_MAX_DIM)
      .then((p) =>
        recordPhoto(
          deps.store,
          deps.blobs,
          // No time typed anywhere: TODAY's photo is stamped "now"; a past day's stays blank.
          { date, time: date === today ? nowHHMM() : '', pose, width: p.width, height: p.height, note },
          p.blob,
          crypto.randomUUID(),
        ),
      )
      .then((ev) => {
        if (!ev) {
          if (msg) msg.textContent = 'לא הצלחנו לשמור את התמונה — נסו תמונה אחרת.';
          return;
        }
        toast('התמונה נשמרה 📸');
        again();
      })
      .catch(() => {
        if (msg) msg.textContent = 'לא הצלחנו לקרוא את התמונה — נסו תמונה אחרת.';
      })
      .finally(() => {
        if (pick) {
          pick.disabled = false;
          pick.textContent = '📷 צילום או בחירה מהגלריה';
        }
        fileInp.value = '';
      });
  });

  /* ---- gallery → viewer ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewerId = btn.dataset['open'] ?? null;
      again();
    });
  });
  main.querySelector<HTMLButtonElement>('#phClose')?.addEventListener('click', () => {
    viewerId = null;
    again();
  });
  main.querySelector<HTMLElement>('.ph-viewer')?.addEventListener('click', (e) => {
    // A tap on the dark backdrop (not the image, not the bar) closes too.
    if (e.target === e.currentTarget) {
      viewerId = null;
      again();
    }
  });

  /* ---- delete (from the viewer) ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['del'];
      if (!id) return;
      if (!confirm('למחוק את התמונה? היא תוסר מהמכשיר ולא ניתן לשחזר אותה.')) return;
      viewerId = null;
      void deletePhoto(deps.store, deps.blobs, id).then(() => {
        revoke(id);
        toast('התמונה נמחקה');
        again();
      });
    });
  });

  /* ---- the custom pose's name ---- */
  main.querySelector<HTMLButtonElement>('#phPoseSave')?.addEventListener('click', () => {
    const name = (main.querySelector<HTMLInputElement>('#phPoseName')?.value ?? '').trim();
    if (name === n.customPoseName) return;
    namePose(deps.store, name);
    toast(name ? 'שם הפוזה נשמר' : 'השם הוסר');
    again();
  });
}
