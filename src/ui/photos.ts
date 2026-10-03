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
 * COMPARING ANY TWO. A tile's ◯ badge picks it (two at most — a third pick
 * replaces the older pick); with two picked, the השוואה card shows them in
 * TIME order in one of three ways: side by side (older on the right, newer on
 * the left — time flows with the reading direction, as on every chart), a
 * wipe slider, or the newer laid over the older at a chosen opacity. With
 * nothing picked, the card offers the pose's first-vs-newest as a start.
 *
 * THE LIVE CAMERA (when `deps.camera` says it can) is a full-screen sheet:
 * the viewfinder, the ghost over it at a chosen opacity, a 3-second timer,
 * a flip button, the shutter — then the shot itself for a yes/no before it
 * is stored. The session is screen-local and STOPPED on close, on a screen
 * reset, and after a save: a camera left running is a battery and a privacy
 * problem. The file picker stays beside it for the day the camera says no.
 *
 * THE BACKUP is a ZIP (photos.json + one JPEG per photo) that the user keeps
 * themselves — the JSON export cannot carry the bytes, and nothing syncs
 * them. Import is ADDITIVE and id-stable: a photo the log knows is skipped
 * (or gets its missing bytes back), a deleted one stays deleted.
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
  PHOTO_MANIFEST_NAME,
  PHOTO_MAX_DIM,
  PHOTO_MAX_NOTE_LEN,
  POSE_NAME_MAX_LEN,
  buildPhotoManifest,
  compareSummary,
  importPhotoBackup,
  parsePhotoManifest,
  deletePhoto,
  latestPhoto,
  namePose,
  photoBytes,
  photoEntries,
  recordPhoto,
  suggestedPair,
  weightForDate,
  type CompareSummary,
  type PhotoRow,
} from '../core/photos.ts';
import type { CameraError, CameraFacing, CameraPort, CameraSession } from '../nutrition/camera.ts';
import { preparePhoto, type PreparedPhoto } from '../nutrition/photo.ts';
import { buildZip, readZip } from '../storage/zip.ts';
import type { BlobStore, DataStore, NutritionState, PhotoPose } from '../storage/DataStore.ts';
import { esc } from './dom.ts';
import { toast } from './toast.ts';
import { fmtDelta, fmtWeight, wUnit } from './weight.ts';
import { isRtl, tr } from '../i18n/locale.ts';
import { photos as M } from '../i18n/messages/photos.ts';

export interface PhotosDeps {
  store: DataStore;
  /** Where the bytes live. */
  blobs: BlobStore;
  /** Repaint header + main in place (no scroll reset). Absent in bare tests. */
  rerender?: () => void;
  /** How a picked file becomes a stored image. Injectable: jsdom has no canvas. */
  prepare?: (file: File, maxDim: number) => Promise<PreparedPhoto>;
  /** The live camera. Absent, or `available()` false = the 📷 live button does not exist. */
  camera?: CameraPort;
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
/** The photos picked for comparison, in pick order (at most two). */
let picked: string[] = [];
export type CompareMode = 'side' | 'wipe' | 'overlay';
let compareMode: CompareMode = 'side';
/** The wipe handle, 0–100 = how much of the NEWER photo shows (from the left). */
let wipePos = 50;
/** The overlay's opacity for the newer photo, 0–100. */
let overlayAlpha = 50;

/** The camera sheet. `null` = closed. */
interface CamState {
  facing: CameraFacing;
  /** The ghost's opacity over the viewfinder, 0–100. */
  ghostAlpha: number;
  /** Count down three seconds before the shutter fires. */
  timer: boolean;
  /** Seconds left in a running countdown, or 0. */
  countdown: number;
  /** The frame just captured, awaiting yes/no, with its preview URL. */
  shot: { photo: PreparedPhoto; url: string } | null;
  error: CameraError | null;
  /** True while `open()` is in flight. */
  opening: boolean;
  /** The card's date + note as they were when the sheet opened (the card re-renders under it). */
  fields: { date: string; note: string };
}
let cam: CamState | null = null;
let camSession: CameraSession | null = null;
let camTimer: ReturnType<typeof setTimeout> | null = null;

/** Stop the stream and forget the sheet — the one exit for every path out. */
function closeCamera(): void {
  if (camTimer !== null) {
    clearTimeout(camTimer);
    camTimer = null;
  }
  camSession?.stop();
  camSession = null;
  if (cam?.shot) {
    try {
      URL.revokeObjectURL(cam.shot.url);
    } catch {
      /* not a real object URL (tests) */
    }
  }
  cam = null;
}

/** The Hebrew lines (kept for importers); the sheet reads the current locale's. */
export const CAMERA_ERROR_HE: Readonly<Record<CameraError, string>> = M.he.cameraError;
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
  picked = [];
  compareMode = 'side';
  wipePos = 50;
  overlayAlpha = 50;
  closeCamera();
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
  const m = tr(M);
  if (rows.length === 0) return m.headlineEmpty;
  const last = rows[rows.length - 1];
  return m.headline(rows.length, last ? fmtDate(last.date) : '');
}

/**
 * A pose's name on screen: the user's own name for the custom pose (content,
 * shown as typed), otherwise the locale's name — core/photos.ts `poseLabel`
 * with the fallback translated.
 */
function poseLabel(n: NutritionState, pose: PhotoPose): string {
  return pose === 'custom' && n.customPoseName ? n.customPoseName : tr(M).pose[pose];
}

/* ------------------------------------------------------------------- html */

function poseSeg(n: NutritionState, active: PhotoPose | PoseFilter, attr: 'pose' | 'filter', withAll: boolean): string {
  const m = tr(M);
  const items: { key: PoseFilter; label: string }[] = [
    ...(withAll ? [{ key: 'all' as const, label: m.all }] : []),
    { key: 'front', label: `🧍 ${poseLabel(n, 'front')}` },
    { key: 'custom', label: `⭐ ${poseLabel(n, 'custom')}` },
  ];
  return `<div class="nt-seg-row" role="group" aria-label="${attr === 'pose' ? m.poseAria : m.filterAria}">${items
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
    ${kg !== null ? `<span class="ph-cap-kg">${fmtWeight(kg)} ${wUnit()}</span>` : ''}`;
}

function shootCard(n: NutritionState, today: string, live: boolean): string {
  const ghost = latestPhoto(n, shootPose);
  const all = tr(M);
  const m = all.shoot;
  const ghostHtml = ghost
    ? `
    <div class="ph-ghost">
      <div class="ph-thumb ph-ghost-img"><img alt="" data-blob="${esc(ghost.id)}"></div>
      <p class="gc-note">${m.ghostNote(esc(poseLabel(n, shootPose)), esc(fmtDate(ghost.date)))}</p>
    </div>`
    : `<p class="gc-note">${shootPose === 'front' ? m.firstFront(all.frontHowTo) : m.firstCustom}</p>`;
  return `
  <section class="game-card ph-shoot">
    <div class="gc-title">${m.title}</div>
    ${poseSeg(n, shootPose, 'pose', false)}
    ${ghostHtml}
    <div class="nt-field-row">
      <label class="nt-field">${m.date}
        <input class="inp" id="phDate" type="date" value="${today}" max="${today}">
      </label>
      <label class="nt-field ph-note-field">${m.note} <span class="gc-sub">${m.optional}</span>
        <input class="inp wt-note-inp" id="phNote" type="text" maxlength="${PHOTO_MAX_NOTE_LEN}" autocomplete="off"
          placeholder="${esc(m.notePlaceholder)}">
      </label>
    </div>
    ${
      live
        ? `<button class="action-btn" id="phLive" type="button">${m.live(ghost !== null)}</button>
    <div class="ph-btn-row">
      <button class="action-btn ghost" id="phShoot" type="button">${m.deviceCamera}</button>
      <button class="action-btn ghost" id="phPick" type="button">${m.gallery}</button>
    </div>`
        : `<div class="ph-btn-row">
      <button class="action-btn" id="phShoot" type="button">${m.shoot}</button>
      <button class="action-btn" id="phPick" type="button">${m.gallery}</button>
    </div>`
    }
    <!-- Two pickers, not one: without \`capture\` Android opens ONLY the gallery,
         and with it iOS opens ONLY the camera — so each button gets its own. -->
    <input type="file" id="phFile" accept="image/*" hidden>
    <input type="file" id="phShot" accept="image/*" capture hidden>
    <p class="gc-note" id="phMsg" role="status"></p>
    <p class="gc-note dim">${m.privacy}</p>
  </section>`;
}

function tile(n: NutritionState, p: PhotoRow): string {
  const idx = picked.indexOf(p.id);
  const on = idx >= 0;
  const m = tr(M).tile;
  return `
    <li class="ph-item ${on ? 'picked' : ''}">
      <button class="ph-tile" type="button" data-open="${esc(p.id)}" aria-label="${esc(m.openAria(fmtDate(p.date)))}">
        <span class="ph-thumb"><img alt="" data-blob="${esc(p.id)}"></span>
        <span class="ph-pose ${p.pose}">${p.pose === 'front' ? '🧍' : '⭐'}</span>
      </button>
      <button class="ph-pick ${on ? 'on' : ''}" type="button" data-pick="${esc(p.id)}" aria-pressed="${on ? 'true' : 'false'}"
        aria-label="${on ? m.unpick : m.pick}">${on ? idx + 1 : ''}</button>
      <div class="ph-cap">${caption(n, p)}</div>
    </li>`;
}

/* ------------------------------------------------------------ comparison */

const COMPARE_MODES: readonly CompareMode[] = ['side', 'wipe', 'overlay'] as const;

function compareCaption(n: NutritionState, p: PhotoRow, which: 'before' | 'after'): string {
  const m = tr(M).compare;
  return `<div class="ph-cmp-cap ${which}">
      <span class="ph-cmp-when">${which === 'before' ? m.before : m.after} · ${esc(fmtDate(p.date))}</span>
      ${caption(n, p).replace(/<span class="ph-cap-date">[\s\S]*?<\/span>\s*/, '')}
    </div>`;
}

function comparePane(s: CompareSummary, n: NutritionState): string {
  const a = s.before;
  const b = s.after;
  const m = tr(M).compare;
  const beforeAlt = esc(m.beforeAlt(fmtDate(a.date)));
  const afterAlt = esc(m.afterAlt(fmtDate(b.date)));
  if (compareMode === 'side') {
    // Reading order: the older at the reading start (the right in Hebrew, the
    // left in English), the newer after it — the flex row follows `dir`.
    return `
    <div class="ph-cmp-side">
      <figure class="ph-cmp-fig"><span class="ph-thumb"><img alt="${beforeAlt}" data-blob="${esc(a.id)}"></span>${compareCaption(n, a, 'before')}</figure>
      <figure class="ph-cmp-fig"><span class="ph-thumb"><img alt="${afterAlt}" data-blob="${esc(b.id)}"></span>${compareCaption(n, b, 'after')}</figure>
    </div>`;
  }
  if (compareMode === 'wipe') {
    if (!isRtl()) {
      // English reads left to right, so the OLDER photo takes the left: it is
      // the clipped layer, the handle sits at the slider's value, and the
      // value is how much of the older photo shows (`wipePos` stays "how much
      // of the newer", the mirror of it).
      const pos = 100 - wipePos;
      return `
    <div class="ph-cmp-box ph-cmp-wipe" style="--pos:${pos}%">
      <img class="ph-cmp-under" alt="${afterAlt}" data-blob="${esc(b.id)}">
      <img class="ph-cmp-over" alt="${beforeAlt}" data-blob="${esc(a.id)}">
      <span class="ph-cmp-handle" aria-hidden="true"></span>
      <span class="ph-cmp-tag before" style="left:6px;right:auto">${m.before}</span><span class="ph-cmp-tag after" style="right:6px;left:auto">${m.after}</span>
    </div>
    <label class="ph-cmp-range">${m.wipeLabel}
      <input type="range" id="phWipe" min="0" max="100" value="${pos}" aria-label="${esc(m.wipeAria)}">
    </label>`;
    }
    // One box, LTR inside so the handle's percentage is the newer photo's width
    // from the LEFT edge — the newer on the left, the older on the right, as beside.
    return `
    <div class="ph-cmp-box ph-cmp-wipe" style="--pos:${wipePos}%">
      <img class="ph-cmp-under" alt="${beforeAlt}" data-blob="${esc(a.id)}">
      <img class="ph-cmp-over" alt="${afterAlt}" data-blob="${esc(b.id)}">
      <span class="ph-cmp-handle" aria-hidden="true"></span>
      <span class="ph-cmp-tag after">${m.after}</span><span class="ph-cmp-tag before">${m.before}</span>
    </div>
    <label class="ph-cmp-range">${m.wipeLabel}
      <input type="range" id="phWipe" min="0" max="100" value="${wipePos}" aria-label="${esc(m.wipeAria)}">
    </label>`;
  }
  return `
    <div class="ph-cmp-box ph-cmp-overlay" style="--alpha:${overlayAlpha / 100}">
      <img class="ph-cmp-under" alt="${beforeAlt}" data-blob="${esc(a.id)}">
      <img class="ph-cmp-over" alt="${afterAlt}" data-blob="${esc(b.id)}">
    </div>
    <label class="ph-cmp-range">${m.alphaLabel} <span class="dim" id="phAlphaVal">${overlayAlpha}%</span>
      <input type="range" id="phAlpha" min="0" max="100" value="${overlayAlpha}" aria-label="${esc(m.alphaLabel)}">
    </label>`;
}

function compareCard(n: NutritionState): string {
  const all = photoEntries(n);
  if (all.length < 2) return '';
  const a = picked[0];
  const b = picked[1];
  const s = a !== undefined && b !== undefined ? compareSummary(n, a, b) : null;
  const m = tr(M).compare;
  if (!s) {
    const pose: PhotoPose = filter === 'custom' ? 'custom' : 'front';
    const pair = suggestedPair(n, pose) ?? suggestedPair(n, pose === 'front' ? 'custom' : 'front');
    const hint = picked.length === 1 ? m.oneHint : m.twoHint;
    return `
  <section class="game-card ph-compare">
    <div class="gc-title">${m.title}</div>
    <p class="gc-note">${hint}</p>
    ${
      pair && picked.length === 0
        ? `<button class="action-btn" id="phSuggest" type="button" data-a="${esc(pair[0])}" data-b="${esc(pair[1])}">${m.suggest}</button>`
        : ''
    }
  </section>`;
  }
  const delta =
    s.deltaKg === null
      ? ''
      : `<span class="cl-item">${m.delta(fmtDelta(s.deltaKg), wUnit())}</span>`;
  return `
  <section class="game-card ph-compare">
    <div class="gc-title">${m.title} <span class="gc-sub">${s.days === 0 ? m.sameDay : m.days(s.days)}</span></div>
    <div class="nt-seg-row" role="group" aria-label="${m.modeAria}">${COMPARE_MODES.map(
      (key) =>
        `<button class="nt-seg ${key === compareMode ? 'active' : ''}" type="button" data-mode="${key}"
        aria-pressed="${key === compareMode ? 'true' : 'false'}">${m.modes[key]}</button>`,
    ).join('')}</div>
    ${comparePane(s, n)}
    <div class="chart-legend ph-cmp-legend">
      <span class="cl-item">${m.span(esc(fmtDate(s.before.date)), esc(fmtDate(s.after.date)))}</span>
      ${s.kgBefore !== null && s.kgAfter !== null ? `<span class="cl-item">${m.kgSpan(fmtWeight(s.kgBefore), fmtWeight(s.kgAfter), wUnit())}</span>` : ''}
      ${delta}
    </div>
    <button class="action-btn ghost ph-cmp-clear" id="phClearPick" type="button">${m.clear}</button>
  </section>`;
}

function galleryCard(n: NutritionState): string {
  const all = photoEntries(n);
  const shown = (filter === 'all' ? all : all.filter((p) => p.pose === filter)).slice().reverse();
  const m = tr(M).gallery;
  const body =
    all.length === 0
      ? `<p class="empty">${m.empty}</p>`
      : shown.length === 0
        ? `<p class="empty">${m.emptyPose}</p>`
        : `<ul class="ph-grid">${shown.map((p) => tile(n, p)).join('')}</ul>`;
  return `
  <section class="game-card ph-gallery">
    <div class="gc-title">${m.title} <span class="gc-sub">${all.length === 0 ? '' : m.sub(all.length, fmtBytes(photoBytes(n)))}</span></div>
    ${all.length > 0 ? poseSeg(n, filter, 'filter', true) : ''}
    ${body}
    ${all.length > 0 ? `<p class="gc-note dim">${m.note}</p>` : ''}
  </section>`;
}

function poseNameCard(n: NutritionState): string {
  const m = tr(M).poseName;
  return `
  <section class="game-card ph-pose-card">
    <div class="gc-title">${m.title} <span class="gc-sub">${m.optional}</span></div>
    <label class="nt-field">${m.field}
      <input class="inp wt-note-inp" id="phPoseName" type="text" maxlength="${POSE_NAME_MAX_LEN}" autocomplete="off"
        value="${esc(n.customPoseName)}" placeholder="${esc(m.placeholder)}">
    </label>
    <button class="action-btn" id="phPoseSave" type="button">${m.save}</button>
    <p class="gc-note dim">${m.note}</p>
  </section>`;
}

function backupCard(n: NutritionState): string {
  const count = photoEntries(n).length;
  const m = tr(M).backup;
  return `
  <section class="game-card ph-backup">
    <div class="gc-title">${m.title} <span class="gc-sub">${m.sub}</span></div>
    <p class="gc-note">${m.note}</p>
    <div class="ph-btn-row">
      <button class="action-btn" id="phExport" type="button" ${count === 0 ? 'disabled' : ''}>${m.export(count)}</button>
      <button class="action-btn" id="phImport" type="button">${m.import}</button>
    </div>
    <input type="file" id="phZip" accept=".zip,application/zip" hidden>
    <p class="gc-note" id="phBackupMsg" role="status"></p>
  </section>`;
}

function viewer(n: NutritionState): string {
  if (viewerId === null) return '';
  const p = photoEntries(n).find((r) => r.id === viewerId);
  if (!p) return '';
  const m = tr(M).viewer;
  return `
  <div class="ph-viewer" role="dialog" aria-modal="true" aria-label="${esc(m.aria(fmtDate(p.date)))}">
    <div class="ph-viewer-bar">
      <button class="ph-vbtn" type="button" id="phClose" aria-label="${m.close}">✕</button>
      <span class="ph-viewer-title">${esc(poseLabel(n, p.pose))}</span>
      <button class="ph-vbtn danger" type="button" data-del="${esc(p.id)}" aria-label="${m.delete}">🗑</button>
    </div>
    <div class="ph-viewer-img"><img alt="${esc(m.alt(fmtDate(p.date)))}" data-blob="${esc(p.id)}"></div>
    <div class="ph-viewer-cap">
      ${caption(n, p)}
      ${p.note ? `<span class="ph-cap-note">${esc(p.note)}</span>` : ''}
      <span class="dim wt-delta" dir="ltr">${p.width}×${p.height} · ${fmtBytes(p.bytes)}</span>
    </div>
  </div>`;
}

/* --------------------------------------------------------- the camera sheet */

function cameraSheet(n: NutritionState): string {
  if (!cam) return '';
  const ghost = latestPhoto(n, shootPose);
  const mirrored = cam.facing === 'user';
  const all = tr(M);
  const m = all.camera;
  if (cam.error) {
    return `
  <div class="ph-cam" role="dialog" aria-modal="true" aria-label="${m.aria}">
    <div class="ph-cam-bar"><button class="ph-vbtn" type="button" id="phCamClose" aria-label="${all.viewer.close}">✕</button><span class="ph-viewer-title">${m.title}</span><span></span></div>
    <div class="ph-cam-stage"><p class="ph-cam-msg" role="alert">${all.cameraError[cam.error]}</p></div>
    <div class="ph-cam-actions">
      <button class="action-btn" id="phCamShot" type="button">${all.shoot.deviceCamera}</button>
      <button class="action-btn ghost" id="phCamPick" type="button">${all.shoot.gallery}</button>
    </div>
  </div>`;
  }
  if (cam.shot) {
    return `
  <div class="ph-cam" role="dialog" aria-modal="true" aria-label="${m.shotAria}">
    <div class="ph-cam-bar"><button class="ph-vbtn" type="button" id="phCamClose" aria-label="${all.viewer.close}">✕</button><span class="ph-viewer-title">${esc(poseLabel(n, shootPose))}</span><span></span></div>
    <div class="ph-cam-stage"><img class="ph-cam-shot" alt="${m.shotAria}" data-shot></div>
    <div class="ph-cam-actions">
      <button class="action-btn ghost" id="phCamRetake" type="button">${m.retake}</button>
      <button class="action-btn" id="phCamSave" type="button">${m.save}</button>
    </div>
  </div>`;
  }
  return `
  <div class="ph-cam" role="dialog" aria-modal="true" aria-label="${m.aria}">
    <div class="ph-cam-bar">
      <button class="ph-vbtn" type="button" id="phCamClose" aria-label="${all.viewer.close}">✕</button>
      <span class="ph-viewer-title">${esc(poseLabel(n, shootPose))}</span>
      <button class="ph-vbtn" type="button" id="phCamFlip" aria-label="${m.flip}">🔄</button>
    </div>
    <div class="ph-cam-stage ${mirrored ? 'mirrored' : ''}" style="--ghost:${cam.ghostAlpha / 100}">
      <video class="ph-cam-video" id="phCamVideo" autoplay muted playsinline></video>
      ${ghost ? `<img class="ph-cam-ghost" alt="" data-blob="${esc(ghost.id)}">` : ''}
      ${cam.opening ? `<p class="ph-cam-msg">${m.opening}</p>` : ''}
      ${cam.countdown > 0 ? `<span class="ph-cam-count" aria-live="assertive">${cam.countdown}</span>` : ''}
      <span class="ph-cam-guide" aria-hidden="true"></span>
    </div>
    ${
      ghost
        ? `<label class="ph-cmp-range ph-cam-range">${m.ghostAlpha} <span class="dim" id="phGhostVal">${cam.ghostAlpha}%</span>
      <input type="range" id="phGhostAlpha" min="0" max="100" value="${cam.ghostAlpha}" aria-label="${m.ghostAlpha}">
    </label>`
        : `<p class="gc-note ph-cam-note">${m.noGhost}</p>`
    }
    <div class="ph-cam-actions">
      <button class="ph-vbtn ${cam.timer ? 'on' : ''}" type="button" id="phCamTimer" aria-pressed="${cam.timer ? 'true' : 'false'}" aria-label="${m.timer}">⏱ 3</button>
      <button class="ph-shutter" type="button" id="phCamShoot" aria-label="${m.shutter}" ${cam.opening || cam.countdown > 0 ? 'disabled' : ''}></button>
      <span class="ph-cam-spacer"></span>
    </div>
  </div>`;
}

/** The whole screen as a string — pure, testable without a DOM. */
export function photosHtml(n: NutritionState, today: string, live = false): string {
  return `
  ${shootCard(n, today, live)}
  ${compareCard(n)}
  ${galleryCard(n)}
  ${poseNameCard(n)}
  ${backupCard(n)}
  ${viewer(n)}
  ${cameraSheet(n)}`;
}

/* ----------------------------------------------------------------- render */

export function renderPhotos(main: HTMLElement, deps: PhotosDeps): void {
  const today = deps.today ?? todayISO();
  const n = deps.store.getState().nutrition;
  main.innerHTML = photosHtml(n, today, deps.camera?.available() === true);
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

  /** The card's date + note, validated; `null` (and the message set) when the date is bad. */
  const formFields = (): { date: string; note: string } | null => {
    const date = (main.querySelector<HTMLInputElement>('#phDate')?.value ?? '').trim() || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
      if (msg) msg.textContent = tr(M).msg.badDate;
      return null;
    }
    return { date, note: (main.querySelector<HTMLInputElement>('#phNote')?.value ?? '').trim() };
  };

  /** Store a prepared image under the card's date/note and the chosen pose. */
  const save = (p: PreparedPhoto, fields: { date: string; note: string }): Promise<boolean> =>
    recordPhoto(
      deps.store,
      deps.blobs,
      // No time typed anywhere: TODAY's photo is stamped "now"; a past day's stays blank.
      {
        date: fields.date,
        time: fields.date === today ? nowHHMM() : '',
        pose: shootPose,
        width: p.width,
        height: p.height,
        note: fields.note,
      },
      p.blob,
      crypto.randomUUID(),
    ).then((ev) => ev !== null);

  const shotInp = main.querySelector<HTMLInputElement>('#phShot');
  const shootBtn = main.querySelector<HTMLButtonElement>('#phShoot');
  pick?.addEventListener('click', () => fileInp?.click());
  shootBtn?.addEventListener('click', () => shotInp?.click());
  /** Both pickers land here: the device camera's shot and a gallery pick are the same file. */
  const onPicked = (inp: HTMLInputElement, btn: HTMLButtonElement | null): void => {
    const file = inp.files?.[0];
    if (!file) return;
    const fields = formFields();
    if (!fields) {
      inp.value = '';
      return;
    }
    const label = btn?.textContent ?? '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = tr(M).msg.saving;
    }
    const prepare = deps.prepare ?? preparePhoto;
    void prepare(file, PHOTO_MAX_DIM)
      .then((p) => save(p, fields))
      .then((ok) => {
        if (!ok) {
          if (msg) msg.textContent = tr(M).msg.saveFailed;
          return;
        }
        toast(tr(M).msg.saved);
        again();
      })
      .catch(() => {
        if (msg) msg.textContent = tr(M).msg.readFailed;
      })
      .finally(() => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = label;
        }
        inp.value = '';
      });
  };
  fileInp?.addEventListener('change', () => onPicked(fileInp, pick));
  shotInp?.addEventListener('change', () => onPicked(shotInp, shootBtn));

  /* ---- the live camera ---- */
  const camera = deps.camera;
  const openCamera = (facing: CameraFacing, fields: { date: string; note: string }): void => {
    if (!camera) return;
    camSession?.stop();
    camSession = null;
    cam = {
      facing,
      ghostAlpha: cam?.ghostAlpha ?? 40,
      timer: cam?.timer ?? false,
      countdown: 0,
      shot: null,
      error: null,
      opening: true,
      fields,
    };
    again();
    void camera.open(facing).then((res) => {
      if (!cam || cam.shot) {
        // Closed (or already captured) while opening: release what we were given.
        if (res.ok) res.session.stop();
        return;
      }
      if (!res.ok) {
        cam = { ...cam, opening: false, error: res.error };
        again();
        return;
      }
      camSession = res.session;
      cam = { ...cam, opening: false, facing: res.session.facing };
      again();
    });
  };
  main.querySelector<HTMLButtonElement>('#phLive')?.addEventListener('click', () => {
    const fields = formFields();
    if (fields) openCamera('user', fields);
  });
  main.querySelector<HTMLButtonElement>('#phCamClose')?.addEventListener('click', () => {
    closeCamera();
    again();
  });
  main.querySelector<HTMLButtonElement>('#phCamPick')?.addEventListener('click', () => {
    closeCamera();
    again();
    main.querySelector<HTMLInputElement>('#phFile')?.click();
  });
  main.querySelector<HTMLButtonElement>('#phCamShot')?.addEventListener('click', () => {
    closeCamera();
    again();
    main.querySelector<HTMLInputElement>('#phShot')?.click();
  });
  main.querySelector<HTMLButtonElement>('#phCamFlip')?.addEventListener('click', () => {
    if (cam) openCamera(cam.facing === 'user' ? 'environment' : 'user', cam.fields);
  });
  main.querySelector<HTMLButtonElement>('#phCamTimer')?.addEventListener('click', () => {
    if (!cam) return;
    cam = { ...cam, timer: !cam.timer };
    again();
  });
  const video = main.querySelector<HTMLVideoElement>('#phCamVideo');
  if (video && camSession) camSession.attach(video);
  // The captured frame's URL is set here, not in the template: the build's
  // verify step reads any literal `<img src=` as a possible external fetch.
  const shotImg = main.querySelector<HTMLImageElement>('img[data-shot]');
  if (shotImg && cam?.shot) {
    shotImg.src = cam.shot.url;
    shotImg.classList.add('ready');
  }
  const ghostRange = main.querySelector<HTMLInputElement>('#phGhostAlpha');
  ghostRange?.addEventListener('input', () => {
    if (!cam) return;
    cam = { ...cam, ghostAlpha: Number(ghostRange.value) };
    main.querySelector<HTMLElement>('.ph-cam-stage')?.style.setProperty('--ghost', String(cam.ghostAlpha / 100));
    const v = main.querySelector<HTMLElement>('#phGhostVal');
    if (v) v.textContent = `${cam.ghostAlpha}%`;
  });
  const shoot = (): void => {
    const session = camSession;
    if (!cam || !session) return;
    void session
      .capture(PHOTO_MAX_DIM)
      .then((photo) => {
        if (!cam) return;
        const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(photo.blob) : '';
        cam = { ...cam, countdown: 0, shot: { photo, url } };
        // The frame is taken — the camera can rest while the user decides.
        session.stop();
        camSession = null;
        again();
      })
      .catch(() => {
        if (!cam) return;
        cam = { ...cam, countdown: 0, error: 'unavailable' };
        again();
      });
  };
  main.querySelector<HTMLButtonElement>('#phCamShoot')?.addEventListener('click', () => {
    if (!cam || cam.countdown > 0) return;
    if (!cam.timer) {
      shoot();
      return;
    }
    const tick = (left: number): void => {
      if (!cam) return;
      if (left === 0) {
        shoot();
        return;
      }
      cam = { ...cam, countdown: left };
      const count = main.querySelector<HTMLElement>('.ph-cam-count');
      if (count) count.textContent = String(left);
      else again();
      camTimer = setTimeout(() => tick(left - 1), 1000);
    };
    tick(3);
  });
  main.querySelector<HTMLButtonElement>('#phCamRetake')?.addEventListener('click', () => {
    if (!cam) return;
    const facing = cam.facing;
    if (cam.shot) {
      try {
        URL.revokeObjectURL(cam.shot.url);
      } catch {
        /* tests */
      }
    }
    cam = { ...cam, shot: null };
    openCamera(facing, cam.fields);
  });
  main.querySelector<HTMLButtonElement>('#phCamSave')?.addEventListener('click', () => {
    const shot = cam?.shot;
    const fields = cam?.fields;
    if (!shot || !fields) return;
    void save(shot.photo, fields).then((ok) => {
      closeCamera();
      if (ok) toast(tr(M).msg.saved);
      else if (msg) msg.textContent = tr(M).msg.saveRetry;
      again();
    });
  });

  /* ---- picking for comparison ---- */
  main.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset['pick'];
      if (!id) return;
      if (picked.includes(id)) picked = picked.filter((p) => p !== id);
      else picked = [...picked, id].slice(-2); // a third pick replaces the oldest pick
      again();
    });
  });
  main.querySelector<HTMLButtonElement>('#phSuggest')?.addEventListener('click', () => {
    const a = main.querySelector<HTMLButtonElement>('#phSuggest')?.dataset['a'];
    const b = main.querySelector<HTMLButtonElement>('#phSuggest')?.dataset['b'];
    if (!a || !b) return;
    picked = [a, b];
    again();
  });
  main.querySelector<HTMLButtonElement>('#phClearPick')?.addEventListener('click', () => {
    picked = [];
    again();
  });
  main.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset['mode'];
      compareMode = m === 'wipe' || m === 'overlay' ? m : 'side';
      again();
    });
  });
  // The two ranges move the LIVE box — no re-render per pixel of a drag.
  const wipe = main.querySelector<HTMLInputElement>('#phWipe');
  wipe?.addEventListener('input', () => {
    // In English the slider IS the handle's position (the older photo's share);
    // `wipePos` keeps meaning "how much of the newer" in both directions.
    const v = Number(wipe.value);
    wipePos = isRtl() ? v : 100 - v;
    main.querySelector<HTMLElement>('.ph-cmp-wipe')?.style.setProperty('--pos', `${v}%`);
  });
  const alpha = main.querySelector<HTMLInputElement>('#phAlpha');
  alpha?.addEventListener('input', () => {
    overlayAlpha = Number(alpha.value);
    main.querySelector<HTMLElement>('.ph-cmp-overlay')?.style.setProperty('--alpha', String(overlayAlpha / 100));
    const v = main.querySelector<HTMLElement>('#phAlphaVal');
    if (v) v.textContent = `${overlayAlpha}%`;
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
      if (!confirm(tr(M).msg.confirmDelete)) return;
      viewerId = null;
      picked = picked.filter((p) => p !== id);
      void deletePhoto(deps.store, deps.blobs, id).then(() => {
        revoke(id);
        toast(tr(M).msg.deleted);
        again();
      });
    });
  });

  /* ---- the ZIP backup ---- */
  const backupMsg = main.querySelector<HTMLElement>('#phBackupMsg');
  const exportBtn = main.querySelector<HTMLButtonElement>('#phExport');
  exportBtn?.addEventListener('click', () => {
    const state = deps.store.getState().nutrition;
    const manifest = buildPhotoManifest(state, Date.now());
    exportBtn.disabled = true;
    const label = exportBtn.textContent ?? '';
    exportBtn.textContent = tr(M).backup.packing;
    void (async () => {
      const entries = [{ name: PHOTO_MANIFEST_NAME, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }];
      let missing = 0;
      for (const p of manifest.photos) {
        const blob = await deps.blobs.get(p.id);
        if (!blob) {
          missing += 1;
          continue;
        }
        entries.push({ name: p.file, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      const zip = new Blob([buildZip(entries)], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip);
      a.download = `progress-photos-${today}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      if (backupMsg) {
        backupMsg.textContent =
          missing > 0
            ? tr(M).backup.doneMissing(missing)
            : tr(M).backup.done(manifest.photos.length, fmtBytes(zip.size));
      }
    })()
      .catch(() => {
        if (backupMsg) backupMsg.textContent = tr(M).backup.exportFailed;
      })
      .finally(() => {
        exportBtn.disabled = false;
        exportBtn.textContent = label;
      });
  });
  const zipInp = main.querySelector<HTMLInputElement>('#phZip');
  main.querySelector<HTMLButtonElement>('#phImport')?.addEventListener('click', () => zipInp?.click());
  zipInp?.addEventListener('change', () => {
    const file = zipInp.files?.[0];
    if (!file) return;
    void (async () => {
      const entries = readZip(new Uint8Array(await file.arrayBuffer()));
      const manifestEntry = entries?.find((e) => e.name === PHOTO_MANIFEST_NAME);
      const manifest = manifestEntry ? parsePhotoManifest(JSON.parse(new TextDecoder().decode(manifestEntry.data))) : null;
      if (!entries || !manifest) {
        if (backupMsg) backupMsg.textContent = tr(M).backup.notBackup;
        return;
      }
      const files = new Map<string, Blob>();
      for (const e of entries) if (e.name !== PHOTO_MANIFEST_NAME) files.set(e.name, new Blob([e.data], { type: 'image/jpeg' }));
      const res = await importPhotoBackup(deps.store, deps.blobs, manifest, files);
      // Bytes may have come back for photos whose tiles were marked missing.
      for (const p of manifest.photos) revoke(p.id);
      toast(res.added + res.restored > 0 ? tr(M).backup.imported(res.added, res.restored) : tr(M).backup.nothingNew);
      again();
    })().catch(() => {
      if (backupMsg) backupMsg.textContent = tr(M).backup.readFailed;
    });
    zipInp.value = '';
  });

  /* ---- the custom pose's name ---- */
  main.querySelector<HTMLButtonElement>('#phPoseSave')?.addEventListener('click', () => {
    const name = (main.querySelector<HTMLInputElement>('#phPoseName')?.value ?? '').trim();
    if (name === n.customPoseName) return;
    namePose(deps.store, name);
    toast(name ? tr(M).msg.poseSaved : tr(M).msg.poseCleared);
    again();
  });
}
