/**
 * @vitest-environment jsdom
 *
 * The 📸 תמונות screen in the real shell: the third inner tab of the 🍽️ hub,
 * taking a photo through the picker (bytes into the BlobStore, ONE event),
 * the ghost of the pose's last photo, the gallery and its filter, the viewer,
 * deleting, and naming the custom pose. Images are hydrated from the store
 * after the HTML lands; jsdom has neither canvas nor object URLs, so the
 * `prepare` step is injected and `URL.createObjectURL` is stubbed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PHOTO_MANIFEST_NAME, photoEntries } from '../src/core/photos.ts';
import { buildZip, readZip } from '../src/storage/zip.ts';
import { logWeight } from '../src/core/weight.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { MemoryBlobStore } from '../src/storage/MemoryBlobStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { CAMERA_ERROR_HE, fmtBytes, photosHeadline, resetPhotosScreen } from '../src/ui/photos.ts';
import type { CameraOpenResult, CameraPort, CameraSession } from '../src/nutrition/camera.ts';
import { RestTimer } from '../src/ui/timer.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

let urlCounter = 0;
/** Every blob handed to createObjectURL, so a download can be inspected. */
let objectUrls: Blob[] = [];
beforeEach(() => {
  objectUrls = [];
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  vi.stubGlobal('confirm', () => true);
  urlCounter = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => {
    objectUrls.push(b);
    return `blob:fake-${(urlCounter += 1)}`;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  resetPhotosScreen();
});

/** A fake `prepare`: no canvas — the "downscaled" image is the file's bytes, 600×800. */
const prepare = (file: File) => Promise.resolve({ blob: file, width: 600, height: 800 });

/** A fake camera: every session captures a fixed 5-byte frame and counts its stops. */
function fakeCamera(result: 'ok' | 'denied' | 'none' = 'ok', available = true) {
  const sessions: { stops: number; attached: number; facing: string }[] = [];
  const port: CameraPort = {
    available: () => available,
    open: (facing): Promise<CameraOpenResult> => {
      if (result !== 'ok') return Promise.resolve({ ok: false, error: result });
      const rec = { stops: 0, attached: 0, facing };
      sessions.push(rec);
      const session: CameraSession = {
        facing,
        attach: () => void (rec.attached += 1),
        capture: () => Promise.resolve({ blob: new Blob([new Uint8Array(5)], { type: 'image/jpeg' }), width: 720, height: 960 }),
        stop: () => void (rec.stops += 1),
      };
      return Promise.resolve({ ok: true, session });
    },
  };
  return { port, sessions };
}

function mount(camera?: CameraPort): { store: LocalStore; blobs: MemoryBlobStore; render: () => void } {
  const store = new LocalStore(fakeStorage());
  const blobs = new MemoryBlobStore();
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const timer = new RestTimer({
    bar: el('timerBar'),
    time: el('tTime'),
    prog: el('tProg'),
    title: el('tTitle'),
    plus: el('tPlus'),
    minus: el('tMinus'),
    pause: el('tPause'),
    reset: el('tReset'),
    close: el('tClose'),
  });
  const app = createApp(store, timer, { photos: { blobs, prepare, ...(camera ? { camera } : {}) } });
  app.render();
  return { store, blobs, render: app.render };
}

function click(sel: string): void {
  const b = document.querySelector<HTMLElement>(sel);
  if (!b) throw new Error(`no element ${sel}`);
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function type(sel: string, value: string): void {
  const inp = document.querySelector<HTMLInputElement>(sel);
  if (!inp) throw new Error(`no input ${sel}`);
  inp.value = value;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

function openPhotos(): void {
  click('#tabs .hub[data-hub="NU"]');
  click('#tabs .tab[data-view="PH"]');
}

/** Drop a file into a hidden picker (the gallery one by default) and fire `change`. */
function pickFile(bytes = 1000, name = 'shot.jpg', sel = '#phFile'): void {
  const inp = document.querySelector<HTMLInputElement>(sel);
  if (!inp) throw new Error('no file input');
  const file = new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
  Object.defineProperty(inp, 'files', { value: [file], configurable: true });
  inp.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Let the prepare → record → rerender → hydrate chain run to the end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('the תמונות screen', () => {
  it('is the third inner tab of the 🍽️ hub, with its own header line and an empty state', () => {
    const { store } = mount();
    openPhotos();
    expect(store.getState().ui.view).toBe('PH');
    expect(document.querySelector('#header .app-title')?.textContent).toContain('תמונות');
    expect(document.querySelector('#header .day-meta')?.textContent).toContain('עוד אין תמונות');
    expect(document.querySelector('.ph-gallery .empty')).not.toBeNull();
    expect(document.querySelector('.ph-viewer')).toBeNull();
    // before the first photo the fixed pose explains itself
    expect(document.querySelector('.ph-shoot .gc-note')?.textContent).toContain('ידיים לצדי הגוף');
    // and the pose segment defaults to it
    expect(document.querySelector('.nt-seg[data-pose="front"]')?.classList.contains('active')).toBe(true);
  });

  it('takes a photo through the picker: bytes in the store, ONE photo_taken with their size, tile + header + ghost update', async () => {
    const { store, blobs } = mount();
    openPhotos();
    type('#phNote', 'בוקר');
    pickFile(1234);
    await settle();

    const events = store.getEvents().filter((e) => e.type === 'photo_taken');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload['bytes']).toBe(1234);
    expect(events[0]?.payload['pose']).toBe('front');
    expect(events[0]?.payload['width']).toBe(600);
    expect(events[0]?.payload['note']).toBe('בוקר');
    expect(events[0]?.payload['time']).toMatch(/^\d{2}:\d{2}$/);
    expect(blobs.size).toBe(1);
    // photo events are local-only — never anything the sync engine would push
    expect(document.querySelectorAll('.ph-grid .ph-item')).toHaveLength(1);
    expect(document.querySelector('#header .day-meta')?.textContent).toContain('1 תמונות');
    // the tile's image was hydrated from the store
    const img = document.querySelector<HTMLImageElement>('.ph-grid img[data-blob]');
    expect(img?.src).toMatch(/^blob:fake-/);
    expect(img?.classList.contains('ready')).toBe(true);
    // and the new-photo card now shows it as the ghost for the next front shot
    expect(document.querySelector('.ph-ghost')).not.toBeNull();
    expect(document.querySelector('.ph-ghost .gc-note')?.textContent).toContain('התמונה האחרונה');
    // the form was reset for the next one
    expect(document.querySelector<HTMLInputElement>('#phNote')?.value).toBe('');
  });

  it('has a separate device-camera picker (capture) beside the gallery one, and both store a photo', async () => {
    const { store } = mount();
    openPhotos();
    // two pickers: the camera one carries `capture` so Android opens the camera, not the gallery
    const shot = document.querySelector<HTMLInputElement>('#phShot');
    const gallery = document.querySelector<HTMLInputElement>('#phFile');
    expect(shot?.hasAttribute('capture')).toBe(true);
    expect(gallery?.hasAttribute('capture')).toBe(false);
    // each button opens ITS picker
    let shotClicks = 0;
    let galleryClicks = 0;
    shot?.addEventListener('click', () => void (shotClicks += 1));
    gallery?.addEventListener('click', () => void (galleryClicks += 1));
    click('#phShoot');
    click('#phPick');
    expect(shotClicks).toBe(1);
    expect(galleryClicks).toBe(1);
    // a file from the camera picker is stored like any other
    pickFile(777, 'cam.jpg', '#phShot');
    await settle();
    const ev = store.getEvents().find((e) => e.type === 'photo_taken');
    expect(ev?.payload['bytes']).toBe(777);
  });

  it('refuses a future date and stores nothing', async () => {
    const { store, blobs } = mount();
    openPhotos();
    const dateInp = document.querySelector<HTMLInputElement>('#phDate');
    if (!dateInp) throw new Error('no date');
    dateInp.value = '2099-01-01';
    pickFile();
    await settle();
    expect(store.getEvents().some((e) => e.type === 'photo_taken')).toBe(false);
    expect(blobs.size).toBe(0);
    expect(document.querySelector('#phMsg')?.textContent).toContain('העתיד');
  });

  it('a past day keeps an empty time, and the tile captions it with the weigh-in nearby', async () => {
    const { store } = mount();
    logWeight(store, { date: '2026-03-01', time: '', kg: 84.2, note: '' }, 'w1');
    openPhotos();
    const dateInp = document.querySelector<HTMLInputElement>('#phDate');
    if (!dateInp) throw new Error('no date');
    dateInp.value = '2026-03-02';
    pickFile();
    await settle();
    const ev = store.getEvents().find((e) => e.type === 'photo_taken');
    expect(ev?.payload['date']).toBe('2026-03-02');
    expect(ev?.payload['time']).toBe('');
    expect(document.querySelector('.ph-cap-kg')?.textContent).toContain('84.2');
  });

  it('the ghost follows the chosen pose, and the gallery filter narrows to one pose', async () => {
    const { store } = mount();
    openPhotos();
    pickFile(); // front
    await settle();
    click('.nt-seg[data-pose="custom"]');
    // no custom photo yet: no ghost, the custom how-to instead
    expect(document.querySelector('.ph-ghost')).toBeNull();
    expect(document.querySelector('.ph-shoot .gc-note')?.textContent).toContain('בפוזה שלכם');
    pickFile(); // custom
    await settle();
    expect(store.getEvents().filter((e) => e.type === 'photo_taken').map((e) => e.payload['pose'])).toEqual([
      'front',
      'custom',
    ]);
    expect(document.querySelector('.ph-ghost')).not.toBeNull();
    expect(document.querySelectorAll('.ph-grid .ph-item')).toHaveLength(2);

    click('.nt-seg[data-filter="front"]');
    expect(document.querySelectorAll('.ph-grid .ph-item')).toHaveLength(1);
    expect(document.querySelector('.ph-grid .ph-pose')?.classList.contains('front')).toBe(true);
    click('.nt-seg[data-filter="all"]');
    expect(document.querySelectorAll('.ph-grid .ph-item')).toHaveLength(2);
  });

  it('opens a photo in the viewer, and deletes it from there (tombstone, bytes gone, tile gone)', async () => {
    const { store, blobs } = mount();
    openPhotos();
    pickFile();
    await settle();
    click('.ph-tile');
    expect(document.querySelector('.ph-viewer')).not.toBeNull();
    expect(document.querySelector('.ph-viewer-title')?.textContent).toBe('חזית');
    await settle();
    expect(document.querySelector<HTMLImageElement>('.ph-viewer-img img')?.src).toMatch(/^blob:fake-/);

    click('#phClose');
    expect(document.querySelector('.ph-viewer')).toBeNull();

    click('.ph-tile');
    click('.ph-viewer [data-del]');
    await settle();
    expect(store.getEvents().filter((e) => e.type === 'photo_deleted')).toHaveLength(1);
    expect(photoEntries(store.getState().nutrition)).toEqual([]);
    expect(blobs.size).toBe(0);
    expect(document.querySelector('.ph-viewer')).toBeNull();
    expect(document.querySelector('.ph-gallery .empty')).not.toBeNull();
  });

  it('marks a photo whose bytes are not on this device instead of showing a broken image', async () => {
    const { store, blobs } = mount();
    openPhotos();
    pickFile();
    await settle();
    await blobs.clear(); // wiped elsewhere, or a JSON import from another device
    resetPhotosScreen(); // …and the app reopened, so nothing is cached from before
    click('.nt-seg[data-filter="all"]');
    await settle();
    expect(document.querySelector('.ph-grid .ph-thumb')?.classList.contains('missing')).toBe(true);
    expect(store.getEvents().filter((e) => e.type === 'photo_taken')).toHaveLength(1);
  });

  it('names the custom pose (one LWW event) and the labels follow it everywhere', () => {
    const { store } = mount();
    openPhotos();
    type('#phPoseName', 'צד ימין');
    click('#phPoseSave');
    expect(store.getEvents().filter((e) => e.type === 'photo_pose_named')).toHaveLength(1);
    expect(store.getState().nutrition.customPoseName).toBe('צד ימין');
    expect(document.querySelector('.nt-seg[data-pose="custom"]')?.textContent).toContain('צד ימין');
    // saving the same name again appends nothing
    click('#phPoseSave');
    expect(store.getEvents().filter((e) => e.type === 'photo_pose_named')).toHaveLength(1);
  });

  it('compares any two: pick badges, time order, the three modes, a third pick replaces, clear', async () => {
    const { store } = mount();
    logWeight(store, { date: '2026-01-10', time: '', kg: 86, note: '' }, 'w1');
    logWeight(store, { date: '2026-03-10', time: '', kg: 83.5, note: '' }, 'w2');
    openPhotos();
    const dateInp = () => document.querySelector<HTMLInputElement>('#phDate') as HTMLInputElement;
    dateInp().value = '2026-01-10';
    pickFile();
    await settle();
    // one photo: no comparison card at all
    expect(document.querySelector('.ph-compare')).toBeNull();
    dateInp().value = '2026-02-10';
    pickFile();
    await settle();
    dateInp().value = '2026-03-10';
    pickFile();
    await settle();

    // three photos, nothing picked: the card offers first-vs-newest
    expect(document.querySelector('.ph-compare')).not.toBeNull();
    expect(document.querySelector('.ph-compare .gc-note')?.textContent).toContain('סמנו שתי תמונות');
    expect(document.querySelector('#phSuggest')).not.toBeNull();

    // pick the newest (first tile) then the oldest (last tile): shown in TIME order regardless
    const badges = () => [...document.querySelectorAll<HTMLButtonElement>('.ph-grid [data-pick]')];
    badges()[0]?.click();
    expect(document.querySelector('.ph-compare .gc-note')?.textContent).toContain('נבחרה תמונה אחת');
    expect(document.querySelectorAll('.ph-item.picked')).toHaveLength(1);
    badges()[2]?.click();
    expect(document.querySelectorAll('.ph-item.picked')).toHaveLength(2);
    expect(document.querySelector('.ph-compare .gc-sub')?.textContent).toContain('59 ימים');
    const figs = [...document.querySelectorAll('.ph-cmp-fig')];
    expect(figs).toHaveLength(2);
    expect(figs[0]?.textContent).toContain('לפני · 10.01.2026');
    expect(figs[1]?.textContent).toContain('אחרי · 10.03.2026');
    expect(document.querySelector('.ph-cmp-legend')?.textContent).toContain('−2.5');
    await settle();
    expect(document.querySelectorAll('.ph-cmp-fig img.ready')).toHaveLength(2);

    // the wipe: one box, the newer clipped by the handle, the range moves it live
    click('[data-mode="wipe"]');
    expect(document.querySelector('.ph-cmp-wipe')).not.toBeNull();
    expect(document.querySelectorAll('.ph-cmp-fig')).toHaveLength(0);
    const wipe = document.querySelector<HTMLInputElement>('#phWipe');
    if (!wipe) throw new Error('no wipe range');
    wipe.value = '80';
    wipe.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector<HTMLElement>('.ph-cmp-wipe')?.style.getPropertyValue('--pos')).toBe('80%');
    // …and the position survives a re-render
    click('[data-mode="overlay"]');
    click('[data-mode="wipe"]');
    expect(document.querySelector<HTMLInputElement>('#phWipe')?.value).toBe('80');

    // the overlay: opacity from the range
    click('[data-mode="overlay"]');
    const alpha = document.querySelector<HTMLInputElement>('#phAlpha');
    if (!alpha) throw new Error('no alpha range');
    alpha.value = '30';
    alpha.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector<HTMLElement>('.ph-cmp-overlay')?.style.getPropertyValue('--alpha')).toBe('0.3');
    expect(document.querySelector('#phAlphaVal')?.textContent).toBe('30%');

    // a third pick replaces the OLDER pick (the newest photo), keeping the second
    badges()[1]?.click();
    expect(document.querySelectorAll('.ph-item.picked')).toHaveLength(2);
    expect(document.querySelector('.ph-compare .gc-sub')?.textContent).toContain('31 ימים');

    // un-picking one drops back to the hint; clearing empties it
    badges()[1]?.click();
    expect(document.querySelector('.ph-compare .gc-note')?.textContent).toContain('נבחרה תמונה אחת');
    badges()[1]?.click();
    click('#phClearPick');
    expect(document.querySelectorAll('.ph-item.picked')).toHaveLength(0);

    // the suggestion picks the pose's whole journey
    click('#phSuggest');
    expect(document.querySelector('.ph-compare .gc-sub')?.textContent).toContain('59 ימים');
  });

  it('deleting a picked photo drops it from the comparison', async () => {
    const { store } = mount();
    openPhotos();
    const dateInp = () => document.querySelector<HTMLInputElement>('#phDate') as HTMLInputElement;
    dateInp().value = '2026-01-10';
    pickFile();
    await settle();
    dateInp().value = '2026-02-10';
    pickFile();
    await settle();
    click('#phSuggest');
    expect(document.querySelectorAll('.ph-cmp-fig')).toHaveLength(2);
    click('.ph-tile');
    click('.ph-viewer [data-del]');
    await settle();
    expect(photoEntries(store.getState().nutrition)).toHaveLength(1);
    expect(document.querySelector('.ph-compare')).toBeNull();
  });

  it('offers the live camera only when a port says it can; the picker stays either way', () => {
    mount();
    openPhotos();
    expect(document.querySelector('#phLive')).toBeNull();
    expect(document.querySelector('#phPick')).not.toBeNull();
    resetPhotosScreen();
    mount(fakeCamera('ok', false).port);
    openPhotos();
    expect(document.querySelector('#phLive')).toBeNull();
    resetPhotosScreen();
    mount(fakeCamera().port);
    openPhotos();
    expect(document.querySelector('#phLive')).not.toBeNull();
    expect(document.querySelector('#phPick')).not.toBeNull();
  });

  it('shoots live: the sheet, the ghost of the pose, the shutter, the yes/no, ONE photo_taken, the camera stopped', async () => {
    const { port, sessions } = fakeCamera();
    const { store, blobs } = mount(port);
    openPhotos();
    // a first front photo, so the next shot has a ghost
    pickFile();
    await settle();

    type('#phNote', 'צילום חי');
    click('#phLive');
    await settle();
    expect(document.querySelector('.ph-cam')).not.toBeNull();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.attached).toBe(1);
    expect(sessions[0]?.facing).toBe('user');
    // the front camera mirrors the stage — video and ghost together
    expect(document.querySelector('.ph-cam-stage')?.classList.contains('mirrored')).toBe(true);
    const ghost = document.querySelector<HTMLImageElement>('.ph-cam-ghost');
    expect(ghost?.dataset['blob']).toBeDefined();
    expect(ghost?.src).toMatch(/^blob:fake-/);
    expect(document.querySelector<HTMLElement>('.ph-cam-stage')?.style.getPropertyValue('--ghost')).toBe('0.4');

    // the ghost's opacity moves the live stage without a re-render
    const range = document.querySelector<HTMLInputElement>('#phGhostAlpha');
    if (!range) throw new Error('no ghost range');
    range.value = '70';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector<HTMLElement>('.ph-cam-stage')?.style.getPropertyValue('--ghost')).toBe('0.7');

    // the shutter: the frame is shown for a yes/no, the camera already released
    click('#phCamShoot');
    await settle();
    expect(document.querySelector('.ph-cam-shot')).not.toBeNull();
    expect(sessions[0]?.stops).toBe(1);
    expect(store.getEvents().filter((e) => e.type === 'photo_taken')).toHaveLength(1); // not yet

    // retake reopens the camera; save stores the frame with the card's note
    click('#phCamRetake');
    await settle();
    expect(sessions).toHaveLength(2);
    expect(document.querySelector('.ph-cam-shot')).toBeNull();
    click('#phCamShoot');
    await settle();
    click('#phCamSave');
    await settle();
    const events = store.getEvents().filter((e) => e.type === 'photo_taken');
    expect(events).toHaveLength(2);
    expect(events[1]?.payload['bytes']).toBe(5);
    expect(events[1]?.payload['width']).toBe(720);
    expect(events[1]?.payload['note']).toBe('צילום חי');
    expect(blobs.size).toBe(2);
    expect(document.querySelector('.ph-cam')).toBeNull();
    expect(sessions.every((s) => s.stops === 1)).toBe(true);
  });

  it('flips the camera, counts down with the timer, and closing stops the stream', async () => {
    vi.useFakeTimers();
    try {
      const { port, sessions } = fakeCamera();
      mount(port);
      openPhotos();
      click('#phLive');
      await vi.advanceTimersByTimeAsync(0);
      click('#phCamFlip');
      await vi.advanceTimersByTimeAsync(0);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.stops).toBe(1);
      expect(sessions[1]?.facing).toBe('environment');
      expect(document.querySelector('.ph-cam-stage')?.classList.contains('mirrored')).toBe(false);
      // no ghost yet: the note says this shot becomes the ghost
      expect(document.querySelector('.ph-cam-note')?.textContent).toContain('הרוח');

      click('#phCamTimer');
      expect(document.querySelector('#phCamTimer')?.getAttribute('aria-pressed')).toBe('true');
      click('#phCamShoot');
      expect(document.querySelector('.ph-cam-count')?.textContent).toBe('3');
      expect(document.querySelector<HTMLButtonElement>('#phCamShoot')?.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(document.querySelector('.ph-cam-count')?.textContent).toBe('2');
      await vi.advanceTimersByTimeAsync(2100);
      expect(document.querySelector('.ph-cam-shot')).not.toBeNull();

      // closing from the yes/no throws the frame away and leaves nothing running
      click('#phCamClose');
      expect(document.querySelector('.ph-cam')).toBeNull();
      expect(sessions.every((s) => s.stops === 1)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says why when the camera says no, and hands over to the picker', async () => {
    const { port } = fakeCamera('denied');
    mount(port);
    openPhotos();
    click('#phLive');
    await settle();
    expect(document.querySelector('.ph-cam-msg')?.textContent).toBe(CAMERA_ERROR_HE.denied);
    expect(document.querySelector('#phCamShoot')).toBeNull();
    // …with both the device camera and the gallery as the way out
    expect(document.querySelector('#phCamShot')).not.toBeNull();
    click('#phCamPick');
    expect(document.querySelector('.ph-cam')).toBeNull();
    expect(document.querySelector('#phPick')).not.toBeNull();
    expect(document.querySelector('#phShoot')).not.toBeNull();
  });

  it('exports a ZIP with the manifest and every photo, and imports one additively', async () => {
    const { store, blobs } = mount();
    openPhotos();
    // nothing to export yet
    expect(document.querySelector<HTMLButtonElement>('#phExport')?.disabled).toBe(true);
    pickFile(300);
    await settle();
    type('#phPoseName', 'צד');
    click('#phPoseSave');
    expect(document.querySelector<HTMLButtonElement>('#phExport')?.disabled).toBe(false);
    expect(document.querySelector('#phExport')?.textContent).toContain('(1)');

    // export: the download is a zip with photos.json + one jpeg
    const before = objectUrls.length;
    click('#phExport');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    const zipBlob = objectUrls.slice(before).find((b) => b.type === 'application/zip');
    expect(zipBlob).toBeDefined();
    const entries = readZip(new Uint8Array(await (zipBlob as Blob).arrayBuffer()));
    expect(entries?.map((e) => e.name)[0]).toBe(PHOTO_MANIFEST_NAME);
    expect(entries).toHaveLength(2);
    expect(entries?.[1]?.data.length).toBe(300);
    const manifest = JSON.parse(new TextDecoder().decode(entries?.[0]?.data));
    expect(manifest.customPoseName).toBe('צד');
    expect(manifest.photos).toHaveLength(1);
    expect(document.querySelector('#phBackupMsg')?.textContent).toContain('הקובץ ירד');

    // wipe the device, import the zip: the photo is back under the same id, with its bytes
    const id = photoEntries(store.getState().nutrition)[0]?.id;
    store.clear();
    await blobs.clear();
    resetPhotosScreen();
    openPhotos();
    expect(document.querySelector('.ph-gallery .empty')).not.toBeNull();
    const zipInp = document.querySelector<HTMLInputElement>('#phZip');
    if (!zipInp) throw new Error('no zip input');
    const file = new File([zipBlob as Blob], 'backup.zip', { type: 'application/zip' });
    Object.defineProperty(zipInp, 'files', { value: [file], configurable: true });
    zipInp.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    expect(photoEntries(store.getState().nutrition).map((p) => p.id)).toEqual([id]);
    expect(blobs.size).toBe(1);
    expect(store.getState().nutrition.customPoseName).toBe('צד');
    expect(document.querySelectorAll('.ph-grid .ph-item')).toHaveLength(1);

    // a foreign file is refused (the screen re-rendered after the import: a fresh input)
    const zipInp2 = document.querySelector<HTMLInputElement>('#phZip');
    if (!zipInp2) throw new Error('no zip input');
    const junk = new File([buildZip([{ name: 'readme.txt', data: new Uint8Array([1]) }])], 'x.zip');
    Object.defineProperty(zipInp2, 'files', { value: [junk], configurable: true });
    zipInp2.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(document.querySelector('#phBackupMsg')?.textContent).toContain('לא קובץ גיבוי');
  });

  it('formats byte counts and the headline', () => {
    expect(fmtBytes(500)).toBe('1 KB');
    expect(fmtBytes(340 * 1024)).toBe('340 KB');
    expect(fmtBytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
    const { store } = mount();
    expect(photosHeadline(store.getState().nutrition)).toContain('עוד אין');
  });
});
