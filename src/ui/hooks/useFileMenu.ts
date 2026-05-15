// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSceneAPI } from '@/scene'
import { sceneDoc } from '@/scene/internals'
import { sceneToBytes, loadSceneIntoDoc } from '@/scene/file'
import { createSampleScene } from '@/scene/sample'
import { useUI } from '@/state/ui'

/**
 * Mount listeners for File menu events from the Electron main process.
 *
 * Channels (sent from `electron/main.ts` via webContents.send when the
 * user clicks a File menu item):
 *
 *   file:new     — clear scene, seed default sample
 *   file:open    — show open dialog, replace current scene with file
 *   file:save    — write current scene to remembered path (or Save As)
 *   file:save-as — show save dialog, write current scene to chosen path
 *
 * Current file path is tracked at module scope. Saved path persists for
 * the session; reopening the app resets to "no current path" (Save then
 * acts like Save As). Persisting the recent-files list is a v0.1.2 add.
 */

declare global {
  interface Window {
    hypermotion?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on?: (
        channel: string,
        listener: (...args: unknown[]) => void,
      ) => () => void
    }
  }
}

export function useFileMenu(): void {
  const api = useSceneAPI()

  useEffect(() => {
    const bridge = window.hypermotion
    if (!bridge || !bridge.on) return

    // Read currentFilePath from the store at the moment of each event —
    // not via useUI()/useState so we don't tear the closure or remount
    // listeners when the path changes.
    const getPath = () => useUI.getState().currentFilePath
    const setFile = (path: string | null, savedAt: number | null) =>
      useUI.getState().setCurrentFile(path, savedAt)

    const offNew = bridge.on('file:new', () => {
      // Clear all nodes, reseed with the default sample scene.
      sceneDoc.transact(() => {
        for (const id of api.getAllNodeIds()) {
          api.deleteNode(id)
        }
        createSampleScene(api)
      })
      setFile(null, null)
    })

    const offOpen = bridge.on('file:open', () => {
      void (async () => {
        const result = (await bridge.invoke('file:show-open-dialog')) as
          | { path: string; bytes: Uint8Array }
          | null
        if (!result) return
        // `loadSceneIntoDoc` materializes the bytes in a side doc and
        // mirrors them into our sceneDoc atomically — avoids the CRDT
        // merge anomalies that the earlier delete-then-applyUpdate path
        // exhibited (e.g. `meta.canvas` ending up undefined after a
        // round-trip, which crashed Canvas reading `meta.canvas.width`).
        loadSceneIntoDoc(sceneDoc, new Uint8Array(result.bytes))
        // Opening a file means "doc state == disk state" — bump the
        // saved timestamp so the TopBar reads "Saved just now" instead
        // of "Unsaved" right after a fresh open.
        setFile(result.path, Date.now())
      })()
    })

    const offSave = bridge.on('file:save', () => {
      void (async () => {
        let path = getPath()
        if (!path) {
          // No path yet — fall through to Save As.
          const chosen = (await bridge.invoke('file:show-save-dialog', {
            suggestedName: `${api.getMeta()?.name || 'Untitled'}.hype`,
          })) as string | null
          if (!chosen) return
          path = chosen
        }
        const bytes = sceneToBytes(sceneDoc)
        const ok = (await bridge.invoke('file:write', {
          path,
          bytes,
        })) as boolean
        if (ok) setFile(path, Date.now())
      })()
    })

    const offSaveAs = bridge.on('file:save-as', () => {
      void (async () => {
        const chosen = (await bridge.invoke('file:show-save-dialog', {
          defaultPath: getPath() ?? undefined,
          suggestedName: `${api.getMeta()?.name || 'Untitled'}.hype`,
        })) as string | null
        if (!chosen) return
        const bytes = sceneToBytes(sceneDoc)
        const ok = (await bridge.invoke('file:write', {
          path: chosen,
          bytes,
        })) as boolean
        if (ok) setFile(chosen, Date.now())
      })()
    })

    return () => {
      offNew?.()
      offOpen?.()
      offSave?.()
      offSaveAs?.()
    }
  }, [api])
}
