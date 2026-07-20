// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import {
  FIGMA_PAYLOAD_LEGACY_VERSION,
  FIGMA_PAYLOAD_VERSION,
  importFigmaPayload,
  parseFigmaPayload,
} from '@/import/figma'
import { useToast } from '@/ui/toastStore'

export const FIGMA_PASTE_TEXT_EVENT = 'hypermotion:figma-paste-text'

/**
 * Listen for paste events anywhere in the document. When the clipboard
 * carries a Hyper Motion / Figma payload (recognized by its magic
 * `format` header), parse it and run the importer.
 *
 * Skipped when the paste lands in a text input — the Inspector's name
 * field, the timeline's duration input, the rename dialog, etc. all
 * still get their normal paste behavior.
 *
 * Mounted once at App.tsx, like the keyboard-shortcut hook.
 *
 * Electron note: in the Electron build, the synchronous
 * `e.clipboardData.getData('text/plain')` returns empty under the
 * default permission policy. We feature-detect the preload bridge
 * (`window.hypermotion.clipboard`) and fall back to the IPC-backed
 * read when the sync path comes up empty. On the web build, the
 * fallback is skipped entirely.
 */
export function useFigmaPaste() {
  const api = useSceneAPI()
  const setSelection = useUI((s) => s.setSelection)
  useEffect(() => {
    const showToast = useToast.getState().show
    const importText = (text: string) => {
      const payload = parseFigmaPayload(text)
      if (!payload) {
        if (text.includes('hyper-motion/figma')) {
          let copiedVersion: unknown
          try {
            copiedVersion = (JSON.parse(text) as { version?: unknown }).version
          } catch {
            // The generic incomplete-data message below covers malformed JSON.
          }
          const versionMismatch =
            typeof copiedVersion === 'number' &&
            copiedVersion !== FIGMA_PAYLOAD_LEGACY_VERSION &&
            copiedVersion !== FIGMA_PAYLOAD_VERSION
              ? `The Figma plugin copied version ${copiedVersion}, but this Hyper Motion build cannot read it. Update or rebuild Hyper Motion, then paste again.`
              : 'The copied data is incomplete. Copy the selection again in Figma, then paste here.'
          showToast({
            tone: 'error',
            title: "Couldn't paste from Figma",
            description: versionMismatch,
          })
          return true
        }
        return false
      }
      const rootId = api.getRoot()
      if (!rootId) {
        showToast({
          tone: 'error',
          title: "Couldn't paste from Figma",
          description: 'The scene is still loading. Wait a moment, then paste again.',
        })
        return true
      }
      const rootCount = payload.nodes.length
      showToast({
        tone: 'loading',
        title: 'Pasting from Figma…',
        description:
          rootCount === 1 ? 'Importing the selected layer.' : `Importing ${rootCount} selected layers.`,
      })
      // Give React one frame to paint the progress toast before a large
      // clipboard payload performs its synchronous scene transaction.
      window.requestAnimationFrame(() => {
        try {
          console.log(
            `[figma-import] received payload — ${payload.nodes.length} root nodes, ` +
              `${Object.keys(payload.assets).length} assets`,
          )
          const ids = importFigmaPayload(payload, api, rootId)
          console.log(
            `[figma-import] created ${ids.length} top-level node(s):`,
            ids,
          )
          if (ids.length > 0) {
            setSelection(ids)
            showToast({
              tone: 'success',
              title: 'Pasted from Figma',
              description:
                ids.length === 1
                  ? '1 layer was added to the canvas.'
                  : `${ids.length} layers were added to the canvas.`,
            })
          } else {
            console.warn(
              '[figma-import] payload arrived but produced 0 nodes — every ' +
                'selected layer was filtered out. Check the payload above.',
            )
            showToast({
              tone: 'error',
              title: "Couldn't paste from Figma",
              description:
                'The selection contains no supported layers. Try copying a frame, shape, text, or vector layer.',
            })
          }
        } catch (error) {
          console.error('[figma-import] paste failed:', error)
          showToast({
            tone: 'error',
            title: "Couldn't paste from Figma",
            description:
              'The selection could not be imported. Try a smaller selection or copy it again in Figma.',
          })
        }
      })
      return true
    }

    const onExternalText = (event: Event) => {
      const text = (event as CustomEvent<string>).detail
      if (text) importText(text)
    }

    const onPaste = (e: ClipboardEvent) => {
      // Don't steal pastes targeting editable surfaces — that includes
      // <input>, <textarea>, and any element with contentEditable.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const sync = e.clipboardData?.getData('text/plain') ?? ''
      if (sync && importText(sync)) {
        e.preventDefault()
        return
      }
      // A non-empty synchronous value that is not ours belongs to the
      // editor's normal paste flow (plain text, URLs, etc.). Do not read the
      // same value again through Electron and mislabel it as a failed Figma
      // paste.
      if (sync) return
      // Sync read came up empty — try the Electron bridge if available.
      // On a web build, `window.hypermotion` is undefined and we just
      // fall through (matches the previous behavior).
      const bridge = window.hypermotion?.clipboard
      if (bridge) {
        bridge
          .readText()
          .then((text) => {
            if (text && importText(text)) {
              e.preventDefault()
            }
          })
          .catch((err) => {
            console.warn('[figma-import] clipboard bridge failed:', err)
          })
      }
    }
    window.addEventListener(FIGMA_PASTE_TEXT_EVENT, onExternalText)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener(FIGMA_PASTE_TEXT_EVENT, onExternalText)
      window.removeEventListener('paste', onPaste)
    }
  }, [api, setSelection])
}
