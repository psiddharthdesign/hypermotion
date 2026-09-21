// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs'

export interface ScenePersistence {
  whenSynced: Promise<void>
  destroy: () => Promise<void>
}

/** Read existing y-indexeddb updates individually, without re-encoding them as one giant update. */
export function persistScene(doc: Y.Doc, dbName = 'hyper-motion-scene'): ScenePersistence {
  let database: IDBDatabase | null = null
  let destroyed = false
  const storeUpdate = (update: Uint8Array) => {
    if (!database || destroyed) return
    const transaction = database.transaction('updates', 'readwrite')
    transaction.objectStore('updates').add(update)
    transaction.onerror = () => console.error('[autosave] Could not persist changes', transaction.error)
  }
  const whenSynced = new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('updates')) db.createObjectStore('updates', { autoIncrement: true })
      if (!db.objectStoreNames.contains('custom')) db.createObjectStore('custom')
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      database = request.result
      if (destroyed) { database.close(); resolve(); return }
      const transaction = database.transaction('updates', 'readonly')
      const cursor = transaction.objectStore('updates').openCursor()
      cursor.onsuccess = () => {
        const item = cursor.result
        if (!item) return
        try {
          // No update listener is attached until hydration is complete. The
          // library's batched hydration emitted a duplicate multi-GB update.
          Y.applyUpdate(doc, new Uint8Array(item.value), 'persistence-load')
          item.continue()
        } catch (error) { transaction.abort(); reject(error) }
      }
      transaction.oncomplete = () => {
        if (!destroyed) doc.on('update', storeUpdate)
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Autosave loading was interrupted.'))
    }
  })
  return {
    whenSynced,
    destroy: async () => {
      destroyed = true
      doc.off('update', storeUpdate)
      await whenSynced.catch(() => {})
      database?.close()
    },
  }
}
