// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import { importFigmaPayload, parseFigmaPayload } from '@/import/figma'

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
    const importText = (text: string) => {
      const payload = parseFigmaPayload(text)
      if (!payload) return false
      const rootId = api.getRoot()
      if (!rootId) return false
      console.log(
        `[figma-import] received payload — ${payload.nodes.length} root nodes, ` +
          `${Object.keys(payload.assets).length} assets`,
      )
      const ids = importFigmaPayload(payload, api, rootId)
      console.log(
        `[figma-import] created ${ids.length} top-level node(s):`,
        ids,
      )
      if (ids.length > 0) setSelection(ids)
      else
        console.warn(
          '[figma-import] payload arrived but produced 0 nodes — every ' +
            'selected layer was filtered out. Check the payload above.',
        )
      return true
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
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [api, setSelection])
}