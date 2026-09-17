/**
 * core/photos.ts — 📸 progress photos: the fold, the drivers, the selectors.
 *
 * DESIGN — metadata in the log, pixels in the BlobStore
 * ----------------------------------------------------
 * A progress photo is ~200 kB; the event log lives in localStorage (~5 MB in
 * total) and is uploaded event by event. So the EVENT carries only what the
 * gallery needs to lay itself out (id, date, time, pose, dimensions, byte
 * size, a note) and the bytes go into the `BlobStore` under the same id. The
 * two are reconciled, never replayed: a `photo_taken` whose blob is missing
 * (wiped, imported from another device's JSON) is a photo the gallery cannot
 * show, and `pruneOrphanBlobs` deletes any blob the log no longer claims.
 *
 * LOCAL-ONLY: photo events are in `LOCAL_ONLY_EVENTS`, so the sync engine
 * never pushes them (the bytes could not follow, and the user asked for the
 * photos to stay on the device). They still fold, rebuild and merge exactly
 * like every other event — a merge is a union, so they survive it.
 *
 * MERGE LAWS (the meal / weigh-in laws, verbatim):
 *   photo_taken       -> first write per id wins; duplicates are no-ops.
 *   photo_deleted     -> a tombstone, union-monotone.
 *   photo_pose_named  -> whole name in the payload, last writer wins.
 *   data_cleared      -> the caller's switch empties the slot (and the
 *                        composition root empties the BlobStore).
 */

import type {
  AppEvent,
  BlobStore,
  DataStore,
  EventType,
  NutritionState,
  PhotoPose,
  PhotoRecord,
  PhotoTakenPayload,
} from '../storage/DataStore.ts';
import { weightEntries } from './weight.ts';

/* -------------------------------------------------------------- constants */

/** The stored image's long side, in pixels — sharp enough to compare, small enough to keep. */
export const PHOTO_MAX_DIM = 1280;
/** Per-photo sanity clamps: a payload is data from an unknown source until proven benign. */
export const PHOTO_MAX_PIXELS = 8192;
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const PHOTO_MAX_NOTE_LEN = 80;
export const POSE_NAME_MAX_LEN = 30;

const POSES: readonly PhotoPose[] = ['front', 'custom'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/** The fixed pose's Hebrew name, and the custom pose's fallback. */
export const POSE_LABEL_HE: Readonly<Record<PhotoPose, string>> = {
  front: 'חזית',
  custom: 'הפוזה שלי',
};

/* ---------------------------------------------------------------- readers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intIn(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n < min || n > max ? null : n;
}

/** Read a pose name: trimmed, one line, capped; anything else is ''. */
export function poseNameOf(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, POSE_NAME_MAX_LEN) : '';
}

/**
 * Read a `photo_taken` payload into a valid `PhotoRecord`, or `null` when it
 * is not a photo (bad date or pose, non-positive dimensions or size). ONE
 * reader for the fold, the normalizer and the live driver.
 */
export function photoRecordOf(payload: Record<string, unknown>): { id: string; rec: PhotoRecord } | null {
  const id = payload['id'];
  const date = payload['date'];
  const pose = payload['pose'];
  if (typeof id !== 'string' || !id) return null;
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) return null;
  if (!POSES.includes(pose as PhotoPose)) return null;
  const width = intIn(payload['width'], 1, PHOTO_MAX_PIXELS);
  const height = intIn(payload['height'], 1, PHOTO_MAX_PIXELS);
  const bytes = intIn(payload['bytes'], 1, PHOTO_MAX_BYTES);
  if (width === null || height === null || bytes === null) return null;
  const time = typeof payload['time'] === 'string' && HHMM_RE.test(payload['time']) ? payload['time'] : '';
  const note =
    typeof payload['note'] === 'string' ? payload['note'].replace(/\s+/g, ' ').trim().slice(0, PHOTO_MAX_NOTE_LEN) : '';
  return { id, rec: { date, time, pose: pose as PhotoPose, width, height, bytes, note } };
}

/** Read the photo third of ANY persisted nutrition blob INTO `n`. Never throws. */
export function normalizePhotos(raw: Record<string, unknown>, n: NutritionState): void {
  const photos = raw['photos'];
  if (isRecord(photos)) {
    for (const key of Object.keys(photos)) {
      const entry = photos[key];
      if (!isRecord(entry)) continue;
      const read = photoRecordOf({ ...entry, id: key });
      if (read) n.photos[key] = read.rec;
    }
  }
  const deleted = raw['photoDeleted'];
  if (isRecord(deleted)) {
    for (const key of Object.keys(deleted)) {
      if (key && deleted[key] === true) n.photoDeleted[key] = true;
    }
  }
  n.customPoseName = poseNameOf(raw['customPoseName']);
}

/* ------------------------------------------------------------------- fold */

/** THE photo fold — one event into the nutrition slot, in place. */
export function applyPhotoEvent(n: NutritionState, type: EventType, payload: Readonly<Record<string, unknown>>): void {
  switch (type) {
    case 'photo_taken': {
      const read = photoRecordOf(payload as Record<string, unknown>);
      if (!read || n.photos[read.id]) break;
      n.photos[read.id] = read.rec;
      break;
    }
    case 'photo_deleted': {
      const id = payload['id'];
      if (typeof id === 'string' && id) n.photoDeleted[id] = true;
      break;
    }
    case 'photo_pose_named':
      n.customPoseName = poseNameOf(payload['name']);
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------- drivers */

/** What the UI knows about a photo before it becomes an event + a blob. */
export interface PhotoInput {
  date: string;
  time: string;
  pose: PhotoPose;
  width: number;
  height: number;
  note: string;
}

/**
 * Store the bytes FIRST, then append the event and mirror it — so the log
 * never claims a photo the store does not hold. Returns `null` (and stores
 * nothing) when the input does not read as a photo. The uuid comes from the
 * caller, which keeps this module deterministic.
 */
export async function recordPhoto(
  store: DataStore,
  blobs: BlobStore,
  input: PhotoInput,
  blob: Blob,
  id: string,
): Promise<AppEvent | null> {
  const payload: PhotoTakenPayload = {
    id,
    date: input.date,
    time: input.time,
    pose: input.pose,
    width: input.width,
    height: input.height,
    bytes: blob.size,
    note: input.note,
  };
  if (!photoRecordOf(payload)) return null;
  await blobs.put(id, blob);
  const ev = store.append('photo_taken', payload);
  store.update((draft) => applyPhotoEvent(draft.nutrition, 'photo_taken', payload));
  return ev;
}

/** Append the tombstone, mirror it, then drop the bytes. */
export async function deletePhoto(store: DataStore, blobs: BlobStore, id: string): Promise<AppEvent | null> {
  if (!id) return null;
  const payload = { id };
  const ev = store.append('photo_deleted', payload);
  store.update((draft) => applyPhotoEvent(draft.nutrition, 'photo_deleted', payload));
  await blobs.delete(id);
  return ev;
}

/** Name (or, with '', un-name) the custom pose — LWW like the goal weight. */
export function namePose(store: DataStore, name: string): AppEvent {
  const payload = { name: poseNameOf(name) };
  const ev = store.append('photo_pose_named', payload);
  store.update((draft) => applyPhotoEvent(draft.nutrition, 'photo_pose_named', payload));
  return ev;
}

/**
 * Delete every blob the log no longer claims — a photo deleted or wiped
 * while this device was not looking (a `data_cleared` from another device
 * folds into an empty slot, but nothing folds into IndexedDB). Run at boot.
 * Returns the ids removed.
 */
export async function pruneOrphanBlobs(n: NutritionState, blobs: BlobStore): Promise<string[]> {
  const live = new Set(photoEntries(n).map((p) => p.id));
  const removed: string[] = [];
  for (const key of await blobs.keys()) {
    if (live.has(key)) continue;
    await blobs.delete(key);
    removed.push(key);
  }
  return removed;
}

/* -------------------------------------------------------------- selectors */

export interface PhotoRow extends PhotoRecord {
  id: string;
}

/** Every live photo (tombstones filtered), OLDEST first by (date, time, id); optionally one pose. */
export function photoEntries(n: NutritionState, pose?: PhotoPose): PhotoRow[] {
  const out: PhotoRow[] = [];
  for (const id of Object.keys(n.photos)) {
    const rec = n.photos[id];
    if (!rec || n.photoDeleted[id]) continue;
    if (pose && rec.pose !== pose) continue;
    out.push({ id, ...rec });
  }
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/** The newest photo of a pose — the ghost the camera shows — or `null`. */
export function latestPhoto(n: NutritionState, pose: PhotoPose): PhotoRow | null {
  const rows = photoEntries(n, pose);
  return rows[rows.length - 1] ?? null;
}

/** The custom pose's display name: what the user called it, or the fallback. */
export function poseLabel(n: NutritionState, pose: PhotoPose): string {
  return pose === 'custom' && n.customPoseName ? n.customPoseName : POSE_LABEL_HE[pose];
}

/** Bytes held by live photos — the storage tally the gallery shows. */
export function photoBytes(n: NutritionState): number {
  return photoEntries(n).reduce((s, p) => s + p.bytes, 0);
}

/**
 * The weight to caption a photo with: the last weigh-in ON OR BEFORE its
 * date, but only if within `maxDays` (a weigh-in from two months earlier
 * says nothing about this photo). `null` when there is none.
 */
export function weightForDate(n: NutritionState, date: string, maxDays = 3): number | null {
  const rows = weightEntries(n);
  let found: { date: string; kg: number } | null = null;
  for (const r of rows) {
    if (r.date <= date) found = r;
    else break;
  }
  if (!found) return null;
  const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${found.date}T00:00:00Z`)) / 86_400_000;
  return gap <= maxDays ? found.kg : null;
}

export interface CompareSummary {
  /** The older of the two and the newer, by (date, time, id). */
  before: PhotoRow;
  after: PhotoRow;
  /** Calendar days between them (0 for the same day). */
  days: number;
  /** The captioning weigh-ins (see `weightForDate`), or `null`. */
  kgBefore: number | null;
  kgAfter: number | null;
  /** after − before, one decimal, or `null` unless both weigh-ins exist. */
  deltaKg: number | null;
}

/**
 * Everything the comparison card says about two photos — in TIME order,
 * whichever order they were picked in. `null` when either id is not a live
 * photo (deleted under the selection).
 */
export function compareSummary(n: NutritionState, idA: string, idB: string): CompareSummary | null {
  const rows = photoEntries(n);
  const a = rows.find((r) => r.id === idA);
  const b = rows.find((r) => r.id === idB);
  if (!a || !b || a.id === b.id) return null;
  const [before, after] = rows.indexOf(a) <= rows.indexOf(b) ? [a, b] : [b, a];
  const days = Math.round((Date.parse(`${after.date}T00:00:00Z`) - Date.parse(`${before.date}T00:00:00Z`)) / 86_400_000);
  const kgBefore = weightForDate(n, before.date);
  const kgAfter = weightForDate(n, after.date);
  const deltaKg = kgBefore !== null && kgAfter !== null ? Math.round((kgAfter - kgBefore) * 10) / 10 : null;
  return { before, after, days, kgBefore, kgAfter, deltaKg };
}

/**
 * The comparison to offer before the user picks one: the first and the
 * newest photo of a pose — the whole journey — or `null` with fewer than two.
 */
export function suggestedPair(n: NutritionState, pose: PhotoPose): [string, string] | null {
  const rows = photoEntries(n, pose);
  const first = rows[0];
  const last = rows[rows.length - 1];
  return first && last && first.id !== last.id ? [first.id, last.id] : null;
}
