// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSceneAPI } from '@/scene'
import { sceneDoc } from '@/scene/internals'
import { sceneToBytes, loadSceneIntoDoc } from '@/scene/file'
import { createSampleScene } from '@/scene/sample'

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

let currentPath: string | null = null

export function useFileMenu(): void {
  const api = useSceneAPI()

  useEffect(() => {
    const bridge = window.hypermotion
    if (!bridge || !bridge.on) return

    const offNew = bridge.on('file:new', () => {
      // Clear all nodes, reseed with the default sample scene.
      sceneDoc.transact(() => {
        for (const id of api.getAllNodeIds()) {
          api.deleteNode(id)
        }
        createSampleScene(api)
      })
      currentPath = null
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
        currentPath = result.path
      })()
    })

    const offSave = bridge.on('file:save', () => {
      void (async () => {
        if (!currentPath) {
          // No path yet — fall through to Save As.
          const chosen = (await bridge.invoke('file:show-save-dialog', {
            suggestedName: `${api.getMeta()?.name || 'Untitled'}.hype`,
          })) as string | null
          if (!chosen) return
          currentPath = chosen
        }
        const bytes = sceneToBytes(sceneDoc)
        await bridge.invoke('file:write', { path: currentPath, bytes })
      })()
    })

    const offSaveAs = bridge.on('file:save-as', () => {
      void (async () => {
        const chosen = (await bridge.invoke('file:show-save-dialog', {
          defaultPath: currentPath ?? undefined,
          suggestedName: `${api.getMeta()?.name || 'Untitled'}.hype`,
        })) as string | null
        if (!chosen) return
        currentPath = chosen
        const bytes = sceneToBytes(sceneDoc)
        await bridge.invoke('file:write', { path: currentPath, bytes })
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
