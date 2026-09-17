/**
 * MemoryBlobStore — the in-memory `BlobStore`.
 *
 * Two jobs: the test double (jsdom has no IndexedDB), and the runtime fallback
 * when IndexedDB is unavailable (private mode on some engines, storage
 * blocked), where the app still works and photos simply last until reload.
 */

import type { BlobStore } from './DataStore.ts';

export class MemoryBlobStore implements BlobStore {
  private readonly map = new Map<string, Blob>();

  put(id: string, blob: Blob): Promise<void> {
    this.map.set(id, blob);
    return Promise.resolve();
  }

  get(id: string): Promise<Blob | null> {
    return Promise.resolve(this.map.get(id) ?? null);
  }

  delete(id: string): Promise<void> {
    this.map.delete(id);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.map.keys()]);
  }

  clear(): Promise<void> {
    this.map.clear();
    return Promise.resolve();
  }

  /** How many blobs are held — for tests. */
  get size(): number {
    return this.map.size;
  }
}
