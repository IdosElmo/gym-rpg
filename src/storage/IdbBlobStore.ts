/**
 * IdbBlobStore — the IndexedDB implementation of `BlobStore`.
 *
 * The only module in the app that is allowed to name `indexedDB`. One
 * database, one object store, keyed by the photo id; each value is the Blob
 * itself (IndexedDB stores Blobs structurally, no base64 round trip). Every
 * request is wrapped in a Promise; the connection is opened lazily and once.
 *
 * `IdbBlobStore.available()` says whether IndexedDB exists at all, so the
 * composition root can fall back to `MemoryBlobStore` instead of throwing in
 * the middle of a boot.
 */

import type { BlobStore } from './DataStore.ts';

export const BLOB_DB_NAME = 'gymrpg-blobs';
export const BLOB_STORE_NAME = 'blobs';
const DB_VERSION = 1;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'));
  });
}

export class IdbBlobStore implements BlobStore {
  private db: Promise<IDBDatabase> | null = null;

  /** Injectable for tests (fake-indexeddb); defaults to the global. */
  constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  static available(): boolean {
    try {
      return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
    } catch {
      return false;
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((resolve, reject) => {
      const req = this.factory.open(BLOB_DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) db.createObjectStore(BLOB_STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
      req.onblocked = () => reject(new Error('indexeddb open blocked'));
    });
    // A failed open must not poison every later call: forget it and retry next time.
    this.db.catch(() => {
      this.db = null;
    });
    return this.db;
  }

  private async tx(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
    const db = await this.open();
    const tx = db.transaction(BLOB_STORE_NAME, mode);
    return { store: tx.objectStore(BLOB_STORE_NAME), tx };
  }

  async put(id: string, blob: Blob): Promise<void> {
    const { store, tx } = await this.tx('readwrite');
    store.put(blob, id);
    await done(tx);
  }

  async get(id: string): Promise<Blob | null> {
    const { store } = await this.tx('readonly');
    const v = await request(store.get(id));
    return v instanceof Blob ? v : null;
  }

  async delete(id: string): Promise<void> {
    const { store, tx } = await this.tx('readwrite');
    store.delete(id);
    await done(tx);
  }

  async keys(): Promise<string[]> {
    const { store } = await this.tx('readonly');
    const ks = await request(store.getAllKeys());
    return ks.map((k) => String(k));
  }

  async clear(): Promise<void> {
    const { store, tx } = await this.tx('readwrite');
    store.clear();
    await done(tx);
  }
}
