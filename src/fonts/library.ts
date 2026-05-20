// SPDX-License-Identifier: Apache-2.0

import type { CustomFont } from '@/scene/types'

/**
 * Global custom-font library, backed by IndexedDB.
 *
 * Stores fonts the user has uploaded across all scenes on this machine.
 * Distinct from `scene.customFonts` (per-scene, embedded in .hype) —
 * the library is the user's reusable collection; the scene-embedded
 * set is whatever's actually used in the current document.
 *
 * Why IndexedDB and not localStorage: font files are binary (10KB–
 * 2MB+). localStorage is strings-only and capped around 5MB total —
 * fills up fast. IndexedDB handles binary blobs natively and has GB+
 * of quota on every modern browser.
 *
 * Schema: one object store keyed by font.id. Values are the full
 * CustomFont (id, name, family, weight, style, format, bytes).
 *
 * Cross-instance sync: no. Two windows of the editor open at the same
 * time will see each other's changes only after a refresh — this
 * matches how the scene's IndexedDB persistence already behaves.
 * Worth revisiting if we ever ship multi-window editing, but for the
 * single-window MVP nobody will notice.
 */

const DB_NAME = 'hypermotion-font-library'
const DB_VERSION = 1
const STORE = 'fonts'

type Listener = () => void
const listeners = new Set<Listener>()

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available'))
  }
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return getDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const store = transaction.objectStore(STORE)
        let result: T | undefined
        Promise.resolve(fn(store))
          .then((r) => {
            result = r
          })
          .catch(reject)
        transaction.oncomplete = () => resolve(result as T)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      }),
  )
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* listener errors shouldn't affect other subscribers */
    }
  }
}

/**
 * React-friendly subscription to library mutations. Components that
 * render the library list should subscribe + re-read on every notify.
 * Returns an unsubscribe function.
 */
export function subscribeLibrary(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** All fonts in the library, in insertion order. */
export async function libraryGetAll(): Promise<CustomFont[]> {
  try {
    return await tx<CustomFont[]>('readonly', (store) => {
      return new Promise<CustomFont[]>((resolve, reject) => {
        const req = store.getAll()
        req.onsuccess = () => resolve((req.result as CustomFont[]) ?? [])
        req.onerror = () => reject(req.error)
      })
    })
  } catch {
    return []
  }
}

export async function libraryGet(id: string): Promise<CustomFont | null> {
  try {
    return await tx<CustomFont | null>('readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(id)
        req.onsuccess = () => resolve((req.result as CustomFont) ?? null)
        req.onerror = () => reject(req.error)
      })
    })
  } catch {
    return null
  }
}

/**
 * Add or replace a font in the library. Idempotent on font.id.
 * Notifies all subscribers on success.
 */
export async function libraryAdd(font: CustomFont): Promise<void> {
  await tx<void>('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.put(font)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  })
  notify()
}

/** Remove a font by id. No-op if it doesn't exist. */
export async function libraryRemove(id: string): Promise<void> {
  await tx<void>('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  })
  notify()
}
