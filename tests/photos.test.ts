/**
 * 📸 progress photos, phase 1 — the storage layer: the fold and its merge
 * laws, the normalizer, the drivers against a BlobStore, the orphan prune,
 * the IndexedDB implementation (on fake-indexeddb), and the one rule that
 * makes photos different from meals and weigh-ins: their events never leave
 * the device.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { applyNutritionEvent, emptyNutrition, normalizeNutrition } from '../src/core/nutrition.ts';
import {
  PHOTO_MAX_NOTE_LEN,
  POSE_NAME_MAX_LEN,
  deletePhoto,
  latestPhoto,
  namePose,
  photoBytes,
  photoEntries,
  photoRecordOf,
  poseLabel,
  compareSummary,
  suggestedPair,
  backupFileName,
  buildPhotoManifest,
  importPhotoBackup,
  parsePhotoManifest,
  pruneOrphanBlobs,
  recordPhoto,
  weightForDate,
  type PhotoInput,
} from '../src/core/photos.ts';
import { logWeight } from '../src/core/weight.ts';
import { LOCAL_ONLY_EVENTS, type AppEvent } from '../src/storage/DataStore.ts';
import { IdbBlobStore } from '../src/storage/IdbBlobStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { MemoryBlobStore } from '../src/storage/MemoryBlobStore.ts';
import { rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const NOW = Date.parse('2026-09-17T10:00:00Z');

function ev(id: string, ts: number, type: AppEvent['type'], payload: Record<string, unknown>): AppEvent {
  return { id, ts, type, payload };
}

function taken(id: string, date: string, pose: 'front' | 'custom' = 'front', extra: Record<string, unknown> = {}) {
  return { id, date, time: '07:30', pose, width: 720, height: 1280, bytes: 180_000, note: '', ...extra };
}

function jpeg(bytes = 12): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

const input = (date: string, pose: 'front' | 'custom' = 'front'): PhotoInput => ({
  date,
  time: '07:30',
  pose,
  width: 720,
  height: 1280,
  note: '',
});

describe('the photo fold', () => {
  it('keeps the FIRST photo_taken per id and ignores duplicates', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'photo_taken', taken('p1', '2026-09-01'));
    applyNutritionEvent(n, 'photo_taken', taken('p1', '2026-09-02', 'custom'));
    expect(n.photos['p1']?.date).toBe('2026-09-01');
    expect(n.photos['p1']?.pose).toBe('front');
  });

  it('a tombstone is monotone and converges in both orders', () => {
    const a = emptyNutrition();
    applyNutritionEvent(a, 'photo_taken', taken('p1', '2026-09-01'));
    applyNutritionEvent(a, 'photo_deleted', { id: 'p1' });
    const b = emptyNutrition();
    applyNutritionEvent(b, 'photo_deleted', { id: 'p1' });
    applyNutritionEvent(b, 'photo_taken', taken('p1', '2026-09-01'));
    expect(photoEntries(a)).toEqual([]);
    expect(photoEntries(b)).toEqual([]);
    expect(a).toEqual(b);
  });

  it('the custom pose name is last-writer-wins, trimmed and capped', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'photo_pose_named', { name: '  צד   שמאל ' });
    expect(n.customPoseName).toBe('צד שמאל');
    applyNutritionEvent(n, 'photo_pose_named', { name: 'x'.repeat(100) });
    expect(n.customPoseName).toHaveLength(POSE_NAME_MAX_LEN);
    applyNutritionEvent(n, 'photo_pose_named', { name: 42 });
    expect(n.customPoseName).toBe('');
  });

  it('rejects what is not a photo: bad date, unknown pose, zero size, absurd dimensions', () => {
    expect(photoRecordOf(taken('p', '2026-9-1'))).toBeNull();
    expect(photoRecordOf(taken('p', '2026-09-01', 'side' as 'front'))).toBeNull();
    expect(photoRecordOf(taken('p', '2026-09-01', 'front', { bytes: 0 }))).toBeNull();
    expect(photoRecordOf(taken('p', '2026-09-01', 'front', { width: 100_000 }))).toBeNull();
    expect(photoRecordOf(taken('', '2026-09-01'))).toBeNull();
    // and clamps the soft fields
    const r = photoRecordOf(taken('p', '2026-09-01', 'custom', { time: '7:30', note: ' אחרי  חופשה '.repeat(20) }));
    expect(r?.rec.time).toBe('');
    expect(r?.rec.note).toHaveLength(PHOTO_MAX_NOTE_LEN);
  });

  it('rebuildFromEvents agrees with the live fold, whichever order two logs merge in', () => {
    const events = [
      ev('e1', NOW + 1, 'photo_taken', taken('p1', '2026-09-01')),
      ev('e2', NOW + 2, 'photo_taken', taken('p2', '2026-09-05', 'custom')),
      ev('e3', NOW + 3, 'photo_pose_named', { name: 'צד' }),
      ev('e4', NOW + 4, 'photo_deleted', { id: 'p1' }),
      ev('e5', NOW + 5, 'photo_pose_named', { name: 'גב' }),
    ];
    const ab = rebuildFromEvents(events, NOW + 10).nutrition;
    const ba = rebuildFromEvents([...events].reverse(), NOW + 10).nutrition;
    expect(ab).toEqual(ba);
    expect(photoEntries(ab).map((p) => p.id)).toEqual(['p2']);
    expect(ab.customPoseName).toBe('גב');
    expect(ab.photoDeleted['p1']).toBe(true);
  });

  it('data_cleared empties the photos with everything else', () => {
    const s = rebuildFromEvents(
      [ev('e1', NOW + 1, 'photo_taken', taken('p1', '2026-09-01')), ev('e2', NOW + 2, 'data_cleared', {})],
      NOW + 10,
    );
    expect(s.nutrition.photos).toEqual({});
    expect(s.nutrition.customPoseName).toBe('');
  });
});

describe('normalizeNutrition, photo third', () => {
  it('reads a v7 blob (no photo fields) as empty, and round-trips a full one', () => {
    const old = normalizeNutrition({ meals: {}, deleted: {}, targets: { calories: null, protein: null } });
    expect(old.photos).toEqual({});
    expect(old.photoDeleted).toEqual({});
    expect(old.customPoseName).toBe('');

    const n = emptyNutrition();
    applyNutritionEvent(n, 'photo_taken', taken('p1', '2026-09-01', 'custom', { note: 'בוקר' }));
    applyNutritionEvent(n, 'photo_deleted', { p2: true, id: 'p2' });
    applyNutritionEvent(n, 'photo_pose_named', { name: 'צד' });
    expect(normalizeNutrition(JSON.parse(JSON.stringify(n)))).toEqual(n);
  });

  it('drops garbage entries and keeps the valid ones', () => {
    const n = normalizeNutrition({
      photos: { ok: taken('ok', '2026-09-01'), bad: { date: 'nope' }, str: 'x' },
      photoDeleted: { a: true, b: 'yes', '': true },
      customPoseName: ['not', 'a', 'string'],
    });
    expect(Object.keys(n.photos)).toEqual(['ok']);
    expect(n.photoDeleted).toEqual({ a: true });
    expect(n.customPoseName).toBe('');
  });
});

describe('the drivers, against a BlobStore', () => {
  it('recordPhoto stores the bytes, appends ONE event with their size, and mirrors the state', async () => {
    const store = new LocalStore(fakeStorage());
    const blobs = new MemoryBlobStore();
    const ev1 = await recordPhoto(store, blobs, input('2026-09-01'), jpeg(1234), 'p1');
    expect(ev1?.type).toBe('photo_taken');
    expect(ev1?.payload['bytes']).toBe(1234);
    expect(store.getEvents().filter((e) => e.type === 'photo_taken')).toHaveLength(1);
    expect(await blobs.get('p1')).not.toBeNull();
    expect(store.getState().nutrition.photos['p1']?.bytes).toBe(1234);
    // the live state IS the replay of the log
    expect(rebuildFromEvents(store.getEvents(), NOW).nutrition.photos).toEqual(store.getState().nutrition.photos);
  });

  it('recordPhoto refuses a bad input and stores NOTHING — no blob without an event', async () => {
    const store = new LocalStore(fakeStorage());
    const blobs = new MemoryBlobStore();
    const bad = await recordPhoto(store, blobs, { ...input('2026-09-01'), width: 0 }, jpeg(), 'p1');
    expect(bad).toBeNull();
    expect(blobs.size).toBe(0);
    expect(store.getEvents().some((e) => e.type === 'photo_taken')).toBe(false);
  });

  it('deletePhoto tombstones, mirrors and drops the bytes', async () => {
    const store = new LocalStore(fakeStorage());
    const blobs = new MemoryBlobStore();
    await recordPhoto(store, blobs, input('2026-09-01'), jpeg(), 'p1');
    await deletePhoto(store, blobs, 'p1');
    expect(store.getState().nutrition.photoDeleted['p1']).toBe(true);
    expect(photoEntries(store.getState().nutrition)).toEqual([]);
    expect(await blobs.get('p1')).toBeNull();
    expect(store.getEvents().filter((e) => e.type === 'photo_deleted')).toHaveLength(1);
  });

  it('namePose appends an LWW event and the label follows it, with the fallback when unnamed', () => {
    const store = new LocalStore(fakeStorage());
    expect(poseLabel(store.getState().nutrition, 'custom')).toBe('הפוזה שלי');
    expect(poseLabel(store.getState().nutrition, 'front')).toBe('חזית');
    namePose(store, ' צד ימין ');
    expect(store.getState().nutrition.customPoseName).toBe('צד ימין');
    expect(poseLabel(store.getState().nutrition, 'custom')).toBe('צד ימין');
    namePose(store, '');
    expect(poseLabel(store.getState().nutrition, 'custom')).toBe('הפוזה שלי');
  });

  it('pruneOrphanBlobs drops every blob the log no longer claims, and only those', async () => {
    const store = new LocalStore(fakeStorage());
    const blobs = new MemoryBlobStore();
    await recordPhoto(store, blobs, input('2026-09-01'), jpeg(), 'keep');
    await blobs.put('orphan', jpeg()); // a photo wiped on another device
    // a tombstone that arrived by merge — the blob was never dropped here
    store.append('photo_taken', taken('gone', '2026-09-02'));
    store.update((d) => applyNutritionEvent(d.nutrition, 'photo_taken', taken('gone', '2026-09-02')));
    await blobs.put('gone', jpeg());
    store.append('photo_deleted', { id: 'gone' });
    store.update((d) => applyNutritionEvent(d.nutrition, 'photo_deleted', { id: 'gone' }));

    const removed = await pruneOrphanBlobs(store.getState().nutrition, blobs);
    expect(removed.sort()).toEqual(['gone', 'orphan']);
    expect(await blobs.keys()).toEqual(['keep']);
  });
});

describe('selectors', () => {
  it('lists live photos oldest first, per pose, and names the latest of a pose', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'photo_taken', taken('b', '2026-09-05'));
    applyNutritionEvent(n, 'photo_taken', taken('a', '2026-09-01'));
    applyNutritionEvent(n, 'photo_taken', taken('c', '2026-09-05', 'custom', { time: '06:00' }));
    applyNutritionEvent(n, 'photo_taken', taken('d', '2026-09-09'));
    applyNutritionEvent(n, 'photo_deleted', { id: 'd' });
    expect(photoEntries(n).map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(photoEntries(n, 'front').map((p) => p.id)).toEqual(['a', 'b']);
    expect(latestPhoto(n, 'front')?.id).toBe('b');
    expect(latestPhoto(n, 'custom')?.id).toBe('c');
    expect(photoBytes(n)).toBe(3 * 180_000);
    const empty = emptyNutrition();
    expect(latestPhoto(empty, 'front')).toBeNull();
    expect(photoBytes(empty)).toBe(0);
  });

  it('captions a photo with the weigh-in on or just before its date, and nothing when too old', () => {
    const store = new LocalStore(fakeStorage());
    logWeight(store, { date: '2026-09-01', time: '', kg: 84, note: '' }, 'w1');
    logWeight(store, { date: '2026-09-10', time: '', kg: 82.5, note: '' }, 'w2');
    const n = store.getState().nutrition;
    expect(weightForDate(n, '2026-09-10')).toBe(82.5);
    expect(weightForDate(n, '2026-09-12')).toBe(82.5); // two days later, still close
    expect(weightForDate(n, '2026-09-03')).toBe(84);
    expect(weightForDate(n, '2026-09-08')).toBeNull(); // a week after the last one — says nothing
    expect(weightForDate(n, '2026-08-01')).toBeNull(); // before any weigh-in
  });
});

describe('IdbBlobStore, on fake-indexeddb', () => {
  it('puts, gets, lists, deletes and clears blobs, keyed by id', async () => {
    const idb = new IdbBlobStore(new IDBFactory());
    expect(await idb.get('nope')).toBeNull();
    await idb.put('p1', jpeg(5));
    await idb.put('p2', jpeg(7));
    const got = await idb.get('p1');
    expect(got?.size).toBe(5);
    expect((await idb.keys()).sort()).toEqual(['p1', 'p2']);
    await idb.put('p1', jpeg(9)); // overwrite
    expect((await idb.get('p1'))?.size).toBe(9);
    await idb.delete('p1');
    expect(await idb.get('p1')).toBeNull();
    expect(await idb.keys()).toEqual(['p2']);
    await idb.clear();
    expect(await idb.keys()).toEqual([]);
  });

  it('two stores on the same factory see the same database', async () => {
    const factory = new IDBFactory();
    const a = new IdbBlobStore(factory);
    const b = new IdbBlobStore(factory);
    await a.put('shared', jpeg(3));
    expect((await b.get('shared'))?.size).toBe(3);
  });

  it('available() reflects whether the global exists', () => {
    expect(IdbBlobStore.available()).toBe(true);
  });
});

describe('photos stay on the device', () => {
  it('every photo event type is local-only, and nothing else is', () => {
    expect([...LOCAL_ONLY_EVENTS].sort()).toEqual(['photo_deleted', 'photo_pose_named', 'photo_taken']);
    expect(LOCAL_ONLY_EVENTS.has('meal_logged')).toBe(false);
    expect(LOCAL_ONLY_EVENTS.has('weight_logged')).toBe(false);
  });
});

describe('comparison selectors', () => {
  function withPhotos() {
    const store = new LocalStore(fakeStorage());
    const n = () => store.getState().nutrition;
    store.update((d) => {
      applyNutritionEvent(d.nutrition, 'photo_taken', taken('a', '2026-06-01'));
      applyNutritionEvent(d.nutrition, 'photo_taken', taken('b', '2026-07-01'));
      applyNutritionEvent(d.nutrition, 'photo_taken', taken('c', '2026-09-01', 'custom'));
    });
    logWeight(store, { date: '2026-06-01', time: '', kg: 86, note: '' }, 'w1');
    logWeight(store, { date: '2026-08-31', time: '', kg: 82.5, note: '' }, 'w2');
    return { store, n };
  }

  it('compareSummary puts the two in time order whichever way they were picked, with days and weight delta', () => {
    const { n } = withPhotos();
    const s = compareSummary(n(), 'c', 'a');
    expect(s?.before.id).toBe('a');
    expect(s?.after.id).toBe('c');
    expect(s?.days).toBe(92);
    expect(s?.kgBefore).toBe(86);
    expect(s?.kgAfter).toBe(82.5);
    expect(s?.deltaKg).toBe(-3.5);
    expect(compareSummary(n(), 'a', 'c')?.before.id).toBe('a');
  });

  it('compareSummary has no delta without a weigh-in near one of them, and is null for a missing or same id', () => {
    const { n } = withPhotos();
    const s = compareSummary(n(), 'a', 'b'); // no weigh-in within 3 days of 2026-07-01
    expect(s?.kgAfter).toBeNull();
    expect(s?.deltaKg).toBeNull();
    expect(s?.days).toBe(30);
    expect(compareSummary(n(), 'a', 'zzz')).toBeNull();
    expect(compareSummary(n(), 'a', 'a')).toBeNull();
  });

  it('suggestedPair is the first and newest of a pose, or null with fewer than two', () => {
    const { n } = withPhotos();
    expect(suggestedPair(n(), 'front')).toEqual(['a', 'b']);
    expect(suggestedPair(n(), 'custom')).toBeNull();
    expect(suggestedPair(emptyNutrition(), 'front')).toBeNull();
  });
});

describe('the photo backup', () => {
  async function seeded() {
    const store = new LocalStore(fakeStorage());
    const blobs = new MemoryBlobStore();
    await recordPhoto(store, blobs, input('2026-09-01'), jpeg(11), 'p1');
    await recordPhoto(store, blobs, input('2026-09-05', 'custom'), jpeg(22), 'p2');
    namePose(store, 'צד');
    return { store, blobs };
  }

  it('builds a manifest of every live photo with a readable, id-unique file name', async () => {
    const { store } = await seeded();
    const m = buildPhotoManifest(store.getState().nutrition, NOW);
    expect(m.format).toBe('gym-rpg-photos');
    expect(m.customPoseName).toBe('צד');
    expect(m.photos.map((p) => p.file)).toEqual(['photos/2026-09-01_front_p1.jpg', 'photos/2026-09-05_custom_p2.jpg']);
    expect(backupFileName({ id: 'a-b-c-d-e-f-g-h-i-j', date: '2026-01-01', pose: 'front', time: '', width: 1, height: 1, bytes: 1, note: '' })).toBe(
      'photos/2026-01-01_front_abcdefgh.jpg',
    );
    // and the manifest reads back as itself
    expect(parsePhotoManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('parsePhotoManifest refuses foreign JSON and drops bad entries', () => {
    expect(parsePhotoManifest({ format: 'gym-rpg-export', photos: [] })).toBeNull();
    expect(parsePhotoManifest('x')).toBeNull();
    const m = parsePhotoManifest({
      format: 'gym-rpg-photos',
      photos: [{ ...taken('ok', '2026-09-01'), file: 'photos/ok.jpg' }, { ...taken('nofile', '2026-09-01') }, { ...taken('bad', 'nope'), file: 'x' }],
      customPoseName: 42,
    });
    expect(m?.photos.map((p) => p.id)).toEqual(['ok']);
    expect(m?.customPoseName).toBe('');
  });

  it('import after a wipe brings every photo back under its ORIGINAL id, and a second import is a no-op', async () => {
    const { store, blobs } = await seeded();
    const m = buildPhotoManifest(store.getState().nutrition, NOW);
    const files = new Map<string, Blob>();
    for (const p of m.photos) files.set(p.file, (await blobs.get(p.id)) as Blob);

    const fresh = new LocalStore(fakeStorage());
    const freshBlobs = new MemoryBlobStore();
    const r1 = await importPhotoBackup(fresh, freshBlobs, m, files);
    expect(r1).toEqual({ added: 2, restored: 0, skipped: 0 });
    expect(photoEntries(fresh.getState().nutrition).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect((await freshBlobs.get('p2'))?.size).toBe(22);
    expect(fresh.getState().nutrition.customPoseName).toBe('צד');
    expect(fresh.getEvents().filter((e) => e.type === 'photo_taken')).toHaveLength(2);

    const r2 = await importPhotoBackup(fresh, freshBlobs, m, files);
    expect(r2).toEqual({ added: 0, restored: 0, skipped: 2 });
    expect(fresh.getEvents().filter((e) => e.type === 'photo_taken')).toHaveLength(2);
  });

  it('restores missing bytes for a known photo, keeps a deleted one deleted, keeps a local pose name', async () => {
    const { store, blobs } = await seeded();
    const m = buildPhotoManifest(store.getState().nutrition, NOW);
    const files = new Map<string, Blob>();
    for (const p of m.photos) files.set(p.file, (await blobs.get(p.id)) as Blob);

    await blobs.delete('p1'); // bytes lost, event kept
    await deletePhoto(store, blobs, 'p2'); // the user's decision
    namePose(store, 'גב');
    const r = await importPhotoBackup(store, blobs, m, files);
    expect(r).toEqual({ added: 0, restored: 1, skipped: 1 });
    expect((await blobs.get('p1'))?.size).toBe(11);
    expect(await blobs.get('p2')).toBeNull();
    expect(photoEntries(store.getState().nutrition).map((p) => p.id)).toEqual(['p1']);
    expect(store.getState().nutrition.customPoseName).toBe('גב');
  });

  it('skips an entry whose file is not in the archive', async () => {
    const store = new LocalStore(fakeStorage());
    const blobs = new MemoryBlobStore();
    const m = parsePhotoManifest({ format: 'gym-rpg-photos', photos: [{ ...taken('p9', '2026-09-01'), file: 'photos/p9.jpg' }] });
    const r = await importPhotoBackup(store, blobs, m as NonNullable<typeof m>, new Map());
    expect(r).toEqual({ added: 0, restored: 0, skipped: 1 });
    expect(blobs.size).toBe(0);
  });
});
