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

import { photoEntries } from '../src/core/photos.ts';
import { logWeight } from '../src/core/weight.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { MemoryBlobStore } from '../src/storage/MemoryBlobStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { fmtBytes, photosHeadline, resetPhotosScreen } from '../src/ui/photos.ts';
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
beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  vi.stubGlobal('confirm', () => true);
  urlCounter = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:fake-${(urlCounter += 1)}`;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  resetPhotosScreen();
});

/** A fake `prepare`: no canvas — the "downscaled" image is the file's bytes, 600×800. */
const prepare = (file: File) => Promise.resolve({ blob: file, width: 600, height: 800 });

function mount(): { store: LocalStore; blobs: MemoryBlobStore; render: () => void } {
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
  const app = createApp(store, timer, { photos: { blobs, prepare } });
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

/** Drop a file into the hidden picker and fire `change`. */
function pickFile(bytes = 1000, name = 'shot.jpg'): void {
  const inp = document.querySelector<HTMLInputElement>('#phFile');
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

  it('formats byte counts and the headline', () => {
    expect(fmtBytes(500)).toBe('1 KB');
    expect(fmtBytes(340 * 1024)).toBe('340 KB');
    expect(fmtBytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
    const { store } = mount();
    expect(photosHeadline(store.getState().nutrition)).toContain('עוד אין');
  });
});
