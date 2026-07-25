// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSceneAPI } from '@/scene'
import { sceneDoc } from '@/scene/internals'
import { sceneToBytes, loadSceneIntoDoc } from '@/scene/file'
import { createSampleScene } from '@/scene/sample'
import { useUI } from '@/state/ui'
import { useToast } from '@/ui/toastStore'

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
 * Current file path lives in UI state. Saved path persists for the
 * session; reopening the app resets to "no current path" (Save then
 * acts like Save As). The Electron main process owns the persisted
 * recent-projects list.
 *
 * Every handler reports failures on the toast. A save that can't reach
 * disk, or an open that hits a corrupt `.hype`, must never look like
 * "nothing happened" — the user would keep working against a file
 * that isn't there.
 */

declare global {
  interface Window {
    hypermotion?: {
      clipboard?: {
        readText: () => Promise<string>
        writeText: (text: string) => Promise<void>
        readFiles?: () => Promise<Array<{ name: string; type: string; bytes: Uint8Array }>>
      }
      media?: {
        normalizeVideo?: (payload: {
          name: string
          type: string
          bytes: Uint8Array
        }) => Promise<{ name: string; type: string; bytes: Uint8Array; normalized: boolean }>
      }
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
    if (!bridge || !bridge.on) {
      const onKeyDown = (event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
          return
        }
        event.preventDefault()
        downloadSceneFile(api.getMeta()?.name || 'Untitled')
        useUI.getState().setCurrentFile(null, Date.now())
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }

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
      run('Open', async () => {
        const result = (await bridge.invoke('file:show-open-dialog')) as
          | { path: string; bytes: Uint8Array }
          | { error: string }
          | null
        if (!result) return
        if ('error' in result) throw new Error(result.error)
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
      })
    })

    const offOpenPath = bridge.on('file:open-path', (path) => {
      if (typeof path !== 'string') return
      run('Open', async () => {
        const bytes = await readSceneFile(bridge, path)
        loadSceneIntoDoc(sceneDoc, bytes)
        setFile(path, Date.now())
      })
    })

    const offSave = bridge.on('file:save', () => {
      run('Save', async () => {
        let path = getPath()
        if (!path) {
          // No path yet — fall through to Save As.
          const chosen = (await bridge.invoke('file:show-save-dialog', {
            suggestedName: `${api.getMeta()?.name || 'Untitled'}.hype`,
          })) as string | null
          if (!chosen) return
          path = chosen
        }
        await writeSceneFile(bridge, path)
        setFile(path, Date.now())
      })
    })

    const offSaveAs = bridge.on('file:save-as', () => {
      run('Save', async () => {
        const chosen = (await bridge.invoke('file:show-save-dialog', {
          defaultPath: getPath() ?? undefined,
          suggestedName: `${api.getMeta()?.name || 'Untitled'}.hype`,
        })) as string | null
        if (!chosen) return
        await writeSceneFile(bridge, chosen)
        setFile(chosen, Date.now())
      })
    })

    return () => {
      offNew?.()
      offOpen?.()
      offOpenPath?.()
      offSave?.()
      offSaveAs?.()
    }
  }, [api])
}

type FileBridge = NonNullable<Window['hypermotion']>

/**
 * Run a File-menu action, reporting any failure on the toast. Without
 * this the menu handlers were fire-and-forget `void (async () => …)()`
 * calls, so a rejected IPC or a corrupt `.hype` produced nothing but
 * an unhandled-rejection warning in a console the user can't see.
 */
function run(label: 'Open' | 'Save', action: () => Promise<void>): void {
  void action().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[file] ${label.toLowerCase()} failed:`, err)
    useToast.getState().show({
      tone: 'error',
      title: label === 'Open' ? "Couldn't open the scene" : "Couldn't save the scene",
      description: message,
    })
  })
}

async function writeSceneFile(bridge: FileBridge, path: string): Promise<void> {
  const bytes = sceneToBytes(sceneDoc)
  const result = (await bridge.invoke('file:write', { path, bytes })) as
    | { ok: true }
    | { ok: false; error: string }
  if (!result.ok) throw new Error(result.error)
}

async function readSceneFile(
  bridge: FileBridge,
  path: string,
): Promise<Uint8Array> {
  const result = (await bridge.invoke('file:read', path)) as
    | { ok: true; bytes: Uint8Array }
    | { ok: false; error: string }
  if (!result.ok) throw new Error(result.error)
  return new Uint8Array(result.bytes)
}

function downloadSceneFile(name: string): void {
  const bytes = sceneToBytes(sceneDoc)
  const copy = new Uint8Array(bytes)
  const arrayBuffer = copy.buffer.slice(
    copy.byteOffset,
    copy.byteOffset + copy.byteLength,
  )
  const blob = new Blob([arrayBuffer], { type: 'application/x-hypermotion' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFilename(name)}.hype`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Untitled'
}
