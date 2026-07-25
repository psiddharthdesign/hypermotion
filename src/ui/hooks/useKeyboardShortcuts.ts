// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { useSceneAPI } from '@/scene'
import type {
  EasingKind,
  KeyframeEasingPreset,
  KeyframeValue,
  NodeId,
  Node as SceneNode,
  PropertyId,
  Track,
} from '@/scene'
import { useUI, type Tool } from '@/state/ui'
import {
  createComponentFromSelection,
  instantiateComponent,
  wrapInAutoLayout,
} from '@/ui/actions'
import { addKeyframe, removeTrack, type TextAnimationConfig } from '@/anim'
import { deleteStaggerSet } from '@/anim/staggerSets'
import { deleteAnimationTracks } from '@/state/groupActions'
import {
  importClipboardFiles,
  readElectronClipboardFiles,
} from '@/ui/importClipboardFiles'
import { toggleStaggerSetEditing } from '@/ui/staggerEditing'
import { FIGMA_PAYLOAD_FORMAT } from '@/import/figma'
import { FIGMA_PASTE_TEXT_EVENT } from '@/ui/hooks/useFigmaPaste'

/**
 * Global keyboard shortcuts.
 *
 * Only one of these should be mounted — the hook attaches a document-level
 * listener. Idiomatic place is in <App>, once.
 *
 * Mental model: we special-case when focus is inside a text input so
 * typing "v" into the Inspector's Name field doesn't silently switch to
 * the Select tool. Events that match an editable target are skipped
 * entirely. Esc is the exception — it always clears selection, even
 * from a focused field (and blurs the field first).
 *
 * Undo/redo is wired via Y.UndoManager, scoped to the scene's nodes and
 * tracks sub-maps. Everything that goes through setNodeProperty /
 * setTrack lands in a transaction on the Y.Doc, so the undo manager
 * captures it automatically.
 */
export function useKeyboardShortcuts() {
  const api = useSceneAPI()
  const setTool = useUI((s) => s.setTool)
  const setSelection = useUI((s) => s.setSelection)
  const clearSelection = useUI((s) => s.clearSelection)
  const resetView = useUI((s) => s.resetView)
  const zoomAt = useUI((s) => s.zoomAt)

  // The Y.UndoManager has its OWN effect that depends only on `api`.
  // Putting it inside the keyboard-shortcut effect (which also reads
  // `view.zoom`) used to wipe undo history on every zoom: each
  // re-run called `undoManager.destroy()` and rebuilt from scratch,
  // so Cmd+Z stopped finding anything as soon as the user scrolled.
  // The ref bridges between effects so the keydown handler can call
  // `undo()` / `redo()` without becoming a dep of either effect.
  const undoManagerRef = useRef<Y.UndoManager | null>(null)
  useEffect(() => {
    const scene = api.doc.getMap('scene')
    const nodesMap = scene.get('nodes') as Y.Map<unknown> | undefined
    const tracksMap = scene.get('tracks') as Y.Map<unknown> | undefined
    const uiStateMap = scene.get('uiState') as Y.Map<unknown> | undefined
    const sectionsMap = scene.get('sections') as Y.Map<unknown> | undefined
    const tracked: Y.AbstractType<unknown>[] = []
    if (nodesMap) tracked.push(nodesMap as unknown as Y.AbstractType<unknown>)
    if (tracksMap) tracked.push(tracksMap as unknown as Y.AbstractType<unknown>)
    // Track the ui-state slab so Cmd+Z covers grouping / ungrouping
    // / collapse-toggle just like it covers transform edits.
    if (uiStateMap)
      tracked.push(uiStateMap as unknown as Y.AbstractType<unknown>)
    // Sections — adding / dragging / resizing / renaming / deleting
    // a section is an undoable scene mutation.
    if (sectionsMap)
      tracked.push(sectionsMap as unknown as Y.AbstractType<unknown>)
    tracked.push(scene as unknown as Y.AbstractType<unknown>)
    const mgr = new Y.UndoManager(tracked, {
      // Group edits within 500ms into a single undo step — mirrors what
      // typing / dragging produces (many micro-transactions per second).
      captureTimeout: 500,
      // Track ordinary null-origin edits plus explicit gesture-boundary edits.
      // Migrations on App.Shell mount use a separate 'migration' origin and
      // therefore cannot pollute the user's undo stack.
      trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]),
    })
    const closeGestureCapture = (transaction: Y.Transaction) => {
      if (transaction.origin === UNDOABLE_GESTURE_ORIGIN) {
        // Relationship-aware actions already commit at the gesture boundary.
        // Keep them as exactly one undo step, even when two actions happen
        // within the normal 500ms typing/drag coalescing window.
        mgr.stopCapturing()
      }
    }
    api.doc.on('afterTransaction', closeGestureCapture)
    undoManagerRef.current = mgr
    return () => {
      api.doc.off('afterTransaction', closeGestureCapture)
      mgr.destroy()
      undoManagerRef.current = null
    }
  }, [api])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Focused controls own shortcuts they explicitly consume. Graph editors
      // use arrows and Delete for control points, never scene layers/tracks.
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const inCurveEditor = !!target?.closest('[data-curve-editor]')
      const isSpace = e.key === ' ' || e.code === 'Space'
      // A focused native button dispatches its click after Space keydown. If
      // the global handler also acts, it runs twice. Ordinary controls own
      // Space; the transport button is the deliberate exception so this
      // handler prevents its native click and toggles exactly once. SVG curve
      // anchors/handles also fall through to the global transport.
      const nativeControl = target?.closest(
        'button, input, textarea, select, [contenteditable="true"]',
      )
      const transportControl = target?.closest('[data-transport-toggle]')
      if (isSpace && nativeControl && !transportControl) return
      if (inCurveEditor && !isSpace) return
      const inField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      // Esc: clear selection + blur focused field. Runs even in fields.
      // Skipped when the context menu is open — the menu's own handler
      // owns Escape in that case, and we don't want both "close menu"
      // and "clear selection" to fire on one keypress.
      if (e.key === 'Escape') {
        if (useUI.getState().contextMenu) return
        if (inField && target) target.blur()
        clearSelection()
        return
      }

      if (inField) return

      const meta = e.metaKey || e.ctrlKey

      // Undo / redo. Read the ref instead of a closed-over variable so
      // the manager's identity can swap (when `api` changes) without
      // also invalidating this handler's dep array.
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const mgr = undoManagerRef.current
        if (!mgr) return
        if (e.shiftKey) mgr.redo()
        else mgr.undo()
        return
      }

      // Zoom. zoomAt takes origin-relative coordinates (see state/ui.ts);
      // (0, 0) means "zoom around the transform origin" which is the
      // workspace center — the natural anchor for keyboard-driven zoom
      // when there's no cursor to latch on to.
      // We read zoom from the store at fire time (not via a hook
      // subscription) so this handler stays a stable closure — listing
      // `view.zoom` in the effect's dep array used to wipe undo history
      // every time the user zoomed.
      if (meta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomAt(useUI.getState().view.zoom * 1.25, 0, 0)
        return
      }
      if (meta && e.key === '-') {
        e.preventDefault()
        zoomAt(useUI.getState().view.zoom / 1.25, 0, 0)
        return
      }
      if (meta && e.key === '0') {
        e.preventDefault()
        resetView()
        return
      }
      if (meta && e.key === '1') {
        e.preventDefault()
        zoomAt(1, 0, 0)
        return
      }

      // Rename — Cmd/Ctrl + R opens the multi-select rename dialog.
      // Single selection still benefits because the dialog supports
      // pattern-based renames (Match + tokens) that the inline rename
      // in the Layers panel doesn't. Empty selection is a no-op.
      if (meta && e.key.toLowerCase() === 'r') {
        const sel = useUI.getState().selection
        if (sel.length === 0) return
        e.preventDefault()
        useUI.getState().setRenameDialogOpen(true)
        return
      }

      // Duplicate
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const sel = useUI.getState().selection
        if (sel.length === 0) return
        const duplicates = sel
          .map((id) => duplicateNode(api, id))
          .filter(Boolean) as NodeId[]
        if (duplicates.length > 0) setSelection(duplicates)
        return
      }

      // Create component — Cmd/Ctrl + Alt/Opt + K.
      // Converts the selection into a master component and keeps it
      // selected so the next Cmd+C / Cmd+V can instantiate it.
      if (meta && e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const sel = useUI.getState().selection
        const componentId = createComponentFromSelection(api, sel)
        if (componentId) setSelection([componentId])
        return
      }

      // Copy — serialize each selected subtree into our module-scoped
      // clipboard. Skip when no selection so Cmd+C inside a focused
      // input still works for ordinary text copy (events from text
      // inputs are already filtered out earlier in the handler).
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
        if (copySelectedTextAnimations(api)) {
          e.preventDefault()
          return
        }
        if (copySelectedKeyframes(api)) {
          e.preventDefault()
          return
        }
        const sel = useUI.getState().selection
        if (sel.length === 0) return
        e.preventDefault()
        clipboard = sel
          .map((id) => serializeSubtree(api, id))
          .filter((x): x is ClipboardNode => x !== null)
        keyframeClipboard = []
        textAnimationClipboard = []
        return
      }

      // Cut — copy, then delete the originals. The selection clears
      // because the underlying nodes are gone; Cmd+V restores them
      // (under root by default, see paste below).
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'x') {
        if (cutSelectedTextAnimations(api)) {
          e.preventDefault()
          return
        }
        if (copySelectedKeyframes(api)) {
          e.preventDefault()
          return
        }
        const sel = useUI.getState().selection
        if (sel.length === 0) return
        e.preventDefault()
        clipboard = sel
          .map((id) => serializeSubtree(api, id))
          .filter((x): x is ClipboardNode => x !== null)
        keyframeClipboard = []
        textAnimationClipboard = []
        for (const id of sel) {
          // Skip root + camera — deleting the artboard or active
          // camera mid-cut leaves the scene in a bad state.
          const n = api.getNode(id)
          if (!n) continue
          if (id === api.getRoot()) continue
          if (n.kind === 'camera') continue
          api.deleteNode(id)
        }
        clearSelection()
        return
      }

      // Paste — recreate each clipboard subtree. Target parent is:
      //   - The current single selection if it's a frame / component
      //     (paste inside the selected container — matches Figma when
      //     you have a frame selected and hit Cmd+V).
      //   - Otherwise the scene root (paste at the top level).
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
        if (pasteTextAnimationsAtPlayhead(api)) {
          e.preventDefault()
          return
        }
        if (pasteKeyframesAtPlayhead(api)) {
          e.preventDefault()
          return
        }
        // If Hyper Motion's in-app clipboard is empty, do not consume
        // Cmd+V. Let the browser/Electron paste event fire so external
        // payloads from the Figma plugin can be read by useFigmaPaste().
        if (clipboard.length === 0) return
        e.preventDefault()
        void (async () => {
          const externalFiles = await readElectronClipboardFiles().catch((err) => {
            console.warn('[clipboard-file-paste] failed:', err)
            return []
          })
          if (externalFiles.length > 0) {
            const ids = await importClipboardFiles(externalFiles, api, api.getRoot() || null, {
              workspaceOnly: false,
            })
            if (ids.length > 0) {
              setSelection(ids)
              return
            }
          }

          // An in-app layer copy can still be populated while the user copies
          // a fresh selection from Figma. Prefer the newest system payload so
          // Cmd+V imports Figma instead of replaying stale internal layers.
          const clipboardBridge = window.hypermotion?.clipboard
          const externalText = clipboardBridge
            ? await clipboardBridge.readText().catch(() => '')
            : ''
          if (externalText.includes(FIGMA_PAYLOAD_FORMAT)) {
            window.dispatchEvent(
              new CustomEvent<string>(FIGMA_PASTE_TEXT_EVENT, {
                detail: externalText,
              }),
            )
            return
          }

          const sel = useUI.getState().selection
          const root = api.getRoot()
          let targetParent: NodeId | null = root || null
          if (sel.length === 1) {
            const only = api.getNode(sel[0]!)
            if (only && (only.kind === 'frame' || only.kind === 'component')) {
              targetParent = only.id
            }
          }
          const newIds = clipboard
            .map((item) => pasteClipboardItem(api, item, targetParent))
            .filter((id): id is NodeId => id !== null)
          if (newIds.length > 0) setSelection(newIds)
        })()
        return
      }

      // Mask — Cmd/Ctrl + Alt/Opt + M. Mirrors Figma's "Use as mask"
      // shortcut. The bottom-most node (lowest z-order, earliest in
      // parent's children array) becomes the mask; the next sibling
      // above it gets clipped to its silhouette in the renderer.
      //
      // Selection rules:
      //   - 0 selected: no-op.
      //   - 1 selected: toggle isMask on it. If a higher sibling exists
      //     it'll be clipped; if not, the flag still lives on the node
      //     and takes effect once a sibling lands above.
      //   - 2+ selected: among the selection, pick the one with the
      //     lowest index in its parent's children array (the visually
      //     bottom-most). Set isMask=true on it; clear isMask on the
      //     others (so users can't accidentally chain masks via the
      //     same shortcut).
      //
      // Selected nodes that don't share a parent are handled per-parent:
      // we still pick the bottom-most within each parent. This is the
      // pragmatic Figma behavior; users mostly mask siblings, but a
      // multi-parent selection shouldn't error out.
      if (meta && e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        const sel = useUI.getState().selection
        if (sel.length === 0) return
        if (sel.length === 1) {
          const n = api.getNode(sel[0]!)
          if (!n) return
          api.setNodeProperty(n.id, 'isMask', !n.isMask)
          return
        }
        // Bucket selected ids by parent, then pick the lowest-index
        // child within each bucket. setNodeProperty calls are batched
        // into one transact so undo treats the whole mask op atomically.
        const byParent = new Map<NodeId, NodeId[]>()
        for (const id of sel) {
          const node = api.getNode(id)
          if (!node || !node.parent) continue
          const list = byParent.get(node.parent) ?? []
          list.push(id)
          byParent.set(node.parent, list)
        }
        api.doc.transact(() => {
          for (const [parentId, ids] of byParent) {
            const parent = api.getNode(parentId)
            if (!parent) continue
            // Sort by parent.children order, take the first (lowest z).
            const siblingOrder = parent.children
            const sortedIds = ids.slice().sort(
              (a, b) => siblingOrder.indexOf(a) - siblingOrder.indexOf(b),
            )
            const maskId = sortedIds[0]!
            // Mask the bottom; clear isMask on every other selected
            // sibling so a mistaken double-press doesn't end up
            // marking multiple masks.
            for (const id of sortedIds) {
              api.setNodeProperty(id, 'isMask', id === maskId)
            }
          }
        })
        return
      }

      // Group / ungroup
      if (meta && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        const sel = useUI.getState().selection
        if (sel.length === 0) return
        if (e.shiftKey) {
          // Ungroup: if selection is a single frame, reparent its
          // children to the frame's parent in-order, then delete the
          // frame. Anything else: no-op (simpler for MVP).
          const onlyId = sel[0]!
          const node = api.getNode(onlyId)
          if (sel.length === 1 && node && node.kind === 'frame' && node.parent) {
            const kids = api.getChildren(onlyId).map((c) => c.id)
            for (const k of kids) api.appendChild(node.parent, k)
            api.deleteNode(onlyId)
            setSelection(kids)
          }
        } else {
          // Group: create a new frame under the common parent and
          // reparent the selection into it. Kept simple: use the first
          // selected node's parent as the target parent.
          const first = api.getNode(sel[0]!)
          if (!first || !first.parent) return
          const frameId = api.createNode('frame', first.parent, {
            name: 'Group',
            size: { width: 'hug', height: 'hug' },
            layout: {
              // Plain group — children keep their own transform.x/y;
              // no flex / grid math.
              mode: 'none',
              direction: 'row',
              justify: 'start',
              align: 'start',
              gap: 0,
              padding: { top: 0, right: 0, bottom: 0, left: 0 },
              wrap: false,
              columns: 3,
              rowGap: 0,
              columnGap: 0,
            },
          })
          for (const id of sel) api.appendChild(frameId, id)
          setSelection([frameId])
        }
        return
      }

      // Shift+Enter: walk selection up to its parent. Matches the
      // Figma habit of "bounce up a level" — faster than clicking in
      // the Layers panel, works even when the panel is collapsed.
      //
      // Multi-select handling:
      //   - All selected nodes share the same parent → select that
      //     parent (the common case: user selected siblings, wants to
      //     pop up to their container).
      //   - Selected nodes have different parents → use the FIRST
      //     selection's parent. Trying to compute a least-common-
      //     ancestor would surprise the user; "first one wins" is
      //     predictable and matches Figma.
      //   - Root is the ceiling — leave selection unchanged rather
      //     than clear it (clearing surprises mid-navigation).
      if (!meta && e.shiftKey && !e.altKey && e.key === 'Enter') {
        e.preventDefault()
        const sel = useUI.getState().selection
        if (sel.length === 0) return
        const parents: Array<NodeId | null> = sel.map((id) => {
          const n = api.getNode(id)
          return n ? n.parent : null
        })
        const firstParent = parents[0]
        if (!firstParent) return
        const allSame = parents.every((p) => p === firstParent)
        const target = allSame ? firstParent : firstParent
        // (`target` is firstParent in both branches today; keeping the
        // ternary so a future "least common ancestor" implementation
        // has an obvious place to land.)
        setSelection([target])
        return
      }

      // Shift+A: auto-layout toggle / wrap. Mirrors Figma.
      //   - Single frame/component selected → toggle that frame's
      //     auto-layout on (flex) or off (none). No new container.
      //   - 2+ items selected → wrap them in a new auto-layout frame.
      //   - Single non-frame selected → wrap that one item too, so the
      //     user can promote a rect/text into an auto-layout container.
      if (!meta && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const sel = useUI.getState().selection
        if (sel.length === 0) return

        if (sel.length === 1) {
          const only = api.getNode(sel[0]!)
          if (
            only &&
            (only.kind === 'frame' || only.kind === 'component') &&
            'layout' in only
          ) {
            // Toggle the existing frame's auto-layout mode rather than
            // wrapping it in a new container. Flips between 'none' and
            // 'flex' — users who want grid go through the Layout section.
            const nextMode = only.layout.mode === 'none' ? 'flex' : 'none'
            api.setNodeProperty(only.id, 'layout', {
              ...only.layout,
              mode: nextMode,
            })
            return
          }
        }

        const newId = wrapInAutoLayout(api, sel)
        if (newId) setSelection([newId])
        return
      }

      // Enter — drill into selected parents' children OR enter text
      // edit mode if the single selection is a text node.
      //
      // Text precedence: matches Figma. A text layer has no children
      // to drill into, so Enter doing nothing on text would be weird —
      // Figma uses Enter to start editing the glyphs, which is what
      // designers reach for. Multi-select with a text node mixed in
      // still drills (the intent is clearly hierarchy navigation, not
      // edit one specific text node).
      //
      // For frames / groups, Enter replaces the selection with the
      // union of every selected node's direct children. De-duped via
      // a Set in case sibling parents share a child reference.
      if (!meta && !e.shiftKey && !e.altKey && e.key === 'Enter') {
        const sel = useUI.getState().selection
        if (sel.length === 1) {
          const onlyNode = api.getNode(sel[0]!)
          if (onlyNode && onlyNode.kind === 'text') {
            e.preventDefault()
            useUI.getState().setEditingTextId(onlyNode.id)
            return
          }
        }
        if (sel.length > 0) {
          const kids: string[] = []
          const seen = new Set<string>()
          for (const id of sel) {
            for (const child of api.getChildren(id)) {
              if (seen.has(child.id)) continue
              seen.add(child.id)
              kids.push(child.id)
            }
          }
          if (kids.length > 0) {
            e.preventDefault()
            setSelection(kids)
            return
          }
        }
        // Fall through if no children — let the event reach any focused
        // control that wants to handle it (buttons, etc.).
      }

      // Arrow Up / Down — reorder the selected layer inside its parent's
      // children array. Only a single, non-root, parented node; multi-
      // selection has no unambiguous "move one slot" semantics. Modifier
      // keys skip this path (Shift/Alt/Meta are reserved for future
      // nudge / bring-to-front / send-to-back behaviors).
      if (
        !meta &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        const sel = useUI.getState().selection
        if (sel.length === 1) {
          const id = sel[0]!
          const node = api.getNode(id)
          if (node && node.parent) {
            const siblings = api.getChildren(node.parent).map((c) => c.id)
            const idx = siblings.indexOf(id)
            const delta = e.key === 'ArrowUp' ? -1 : 1
            const target = idx + delta
            if (idx >= 0 && target >= 0 && target < siblings.length) {
              e.preventDefault()
              api.moveChild(node.parent, id, target)
              return
            }
          }
        }
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        // Track-focus takes precedence: if the user just clicked a
        // track row in the Timeline, Delete removes that track (its
        // keyframes), leaving the owning scene node intact. Layer
        // selection actions clear `selectedTrackId` so this only fires
        // when the user is truly working in track-edit mode.
        const ui = useUI.getState()
        if (ui.selectedStaggerSetId) {
          const setId = ui.selectedStaggerSetId
          if (api.getUiState().staggerSets[setId]) {
            deleteStaggerSet(api, setId)
            if (ui.activeStaggerSetId === setId) ui.setStaggerOn(false)
            ui.setSelectedStaggerSetId(null)
            ui.setSelectedKeyframes([])
            ui.setSelectedTrackIds([])
            ui.setSelectedTrackId(null)
            return
          }
          ui.setSelectedStaggerSetId(null)
        }
        if (ui.selectedTrackIds.length > 0) {
          deleteAnimationTracks(api, ui.selectedTrackIds)
          ui.setSelectedTrackIds([])
          ui.setSelectedTrackId(null)
          return
        }
        if (ui.selectedTrackId) {
          removeTrack(api, ui.selectedTrackId)
          ui.setSelectedTrackId(null)
          return
        }
        for (const id of ui.selection) {
          const n = api.getNode(id)
          if (!n) continue
          if (id === api.getRoot()) continue // never delete the scene root
          if (n.kind === 'camera') continue
          if (n.parent || n.workspaceOnly) api.deleteNode(id)
        }
        clearSelection()
        return
      }

      // Tool shortcuts — single letter, no modifiers.
      if (meta || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.repeat) return
        const ui = useUI.getState()
        const selectedSetId = ui.selectedStaggerSetId
        const selectedSet = selectedSetId
          ? api.getUiState().staggerSets[selectedSetId]
          : undefined
        if (selectedSetId && selectedSet) {
          toggleStaggerSetEditing(api, selectedSetId)
          return
        }
        if (selectedSetId && !selectedSet) {
          ui.setSelectedStaggerSetId(null)
        }
        // No existing relationship is selected: S starts/stops a fresh local
        // authoring session for the current layer selection.
        ui.setStaggerOn(!ui.staggerOn)
        return
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) {
        e.preventDefault()
        setTool(tool)
        return
      }

      // Space toggles play.
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        // Holding Space must remain one transport command. Native key repeat
        // otherwise flips play/pause several times per second and makes the
        // canvas look as if playback itself is dropping frames.
        if (e.repeat) return
        useUI.setState((s) => ({ playing: !s.playing }))
        return
      }

      // `[` / `]` — step the playhead backward / forward by one frame.
      // Unit is 1/frameRate seconds. Pauses playback on step so the user
      // sees the new frame instead of bouncing back to wherever the
      // playhead is marching. Clamp to [0, duration] so we don't roll
      // under zero or past the comp end.
      if (!meta && !e.shiftKey && !e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        const { frameRate, duration } = api.getMeta()
        const step = 1 / Math.max(1, frameRate)
        const cur = useUI.getState().playhead
        const next = e.key === '['
          ? Math.max(0, cur - step)
          : Math.min(duration, cur + step)
        useUI.setState({ playhead: next, playing: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // UndoManager teardown lives in its own effect — don't reference
      // it here. Mixing the two cleanup paths used to wipe undo
      // history on every zoom (see the dedicated effect above).
    }
  }, [api, setTool, setSelection, clearSelection, resetView, zoomAt])
}

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  f: 'frame',
  r: 'rect',
  o: 'ellipse',
  t: 'text',
  h: 'hand',
}

/**
 * Duplicate a node + its subtree under the same parent, placing the
 * copy immediately after the original in the children list. Offsets
 * the copy by (+16, +16) in transform so it's visually distinct.
 *
 * Returns the new root-of-duplicated-subtree id.
 */
function duplicateNode(
  api: ReturnType<typeof useSceneAPI>,
  id: NodeId,
): NodeId | null {
  const original = api.getNode(id)
  if (!original || !original.parent) return null
  if (original.kind === 'camera') return null
  if (original.kind === 'component') return instantiateComponent(api, original.id)

  const cloneSubtree = (src: SceneNode, parent: NodeId): NodeId => {
    const newId = api.createNode(src.kind, parent, {
      // Strip the id / parent / children — createNode provides fresh ones.
      name: src.name + ' copy',
      ...stripLinks(src),
    } as Partial<SceneNode>)
    // Carry the animation with the duplicate. Every track on the source
    // node gets recreated against `newId` with fresh track + keyframe ids;
    // timing, values, and easings are preserved byte-for-byte. Without
    // this step Cmd+D produces a visually-identical copy that "forgets"
    // how to animate — which is a trap when duplicating an auto-layout
    // that already has IN/OUT presets applied.
    for (const track of api.getTracksForNode(src.id)) {
      api.setTrack({
        id: genTrackId(),
        nodeId: newId,
        propertyId: track.propertyId,
        defaultEasing: track.defaultEasing,
        keyframes: track.keyframes.map((k) => ({ ...k, id: genTrackId() })),
      })
    }
    for (const child of api.getChildren(src.id)) {
      cloneSubtree(child, newId)
    }
    return newId
  }

  const newId = cloneSubtree(original, original.parent)
  const copy = api.getNode(newId)
  if (copy) {
    // Only nudge the transform when the parent is 'none' (free canvas).
    // Under flex / grid, Yoga decides the duplicate's position in flow;
    // a transform offset would smear the copy off its assigned slot and
    // visually break the layout. This matches Figma: Cmd+D inside an
    // auto-layout frame appends a neighbor at its flow position; on the
    // free canvas, it puts the copy (+16, +16) from the original.
    const parentNode = api.getNode(original.parent)
    const parentMode =
      parentNode && 'layout' in parentNode ? parentNode.layout.mode : 'none'
    if (parentMode === 'none') {
      api.setNodeProperty(newId, 'transform', {
        ...copy.transform,
        x: copy.transform.x + 16,
        y: copy.transform.y + 16,
      })
    } else {
      // Zero the transform so the duplicate doesn't carry the original's
      // drift into its flow slot. (An original created pre-wrap can have
      // non-zero transform baked in from its mode='none' days.)
      api.setNodeProperty(newId, 'transform', {
        x: 0,
        y: 0,
        z: copy.transform.z,
        rotation: copy.transform.rotation,
        rotationX: copy.transform.rotationX,
        rotationY: copy.transform.rotationY,
        scaleX: copy.transform.scaleX,
        scaleY: copy.transform.scaleY,
      })
    }
  }
  return newId
}

// ---------------------------------------------------------------------------
// Clipboard for Cmd+C / Cmd+X / Cmd+V
// ---------------------------------------------------------------------------
//
// The clipboard lives at module scope (not in the React store) so it
// survives panel re-mounts and isn't subject to React re-renders. We
// store a serialized snapshot of each selected subtree plus every track
// on each node — same shape duplicateNode carries — so paste can run
// even after a cut deletes the originals.
//
// Why not the system clipboard via navigator.clipboard.write: the v1
// goal is single-app cut/copy/paste so the user can reorganize their
// scene. Cross-app paste (paste a frame into Figma, paste a Figma
// frame here) is its own design problem — needs format negotiation,
// asset embedding, and SVG/Lottie translation. Out of scope here.

interface ClipboardNode {
  /** A SceneNode minus the structural id / parent / children fields. */
  data: Record<string, unknown>
  kind: SceneNode['kind']
  children: ClipboardNode[]
  /** Tracks attached to THIS node (not children — those carry their own). */
  tracks: Array<{
    propertyId: string
    defaultEasing: unknown
    keyframes: unknown[]
    textAnimation?: unknown
  }>
  /** When set, paste creates a linked instance instead of a detached clone. */
  componentId?: NodeId
}

let clipboard: ClipboardNode[] = []

interface ClipboardKeyframe {
  nodeId: NodeId
  propertyId: PropertyId
  offset: number
  value: KeyframeValue
  easingOut?: EasingKind
  easingPreset?: KeyframeEasingPreset
  presetOrigin?: 'in' | 'out'
}

let keyframeClipboard: ClipboardKeyframe[] = []

interface ClipboardTextAnimation {
  sourceTrackId: string
  nodeId: NodeId
  start: number
  defaultEasing: EasingKind
  textAnimation: TextAnimationConfig
  keyframes: Array<{
    time: number
    value: KeyframeValue
    easingOut?: EasingKind
    easingPreset?: KeyframeEasingPreset
    presetOrigin?: 'in' | 'out'
  }>
}

let textAnimationClipboard: ClipboardTextAnimation[] = []

function serializeSubtree(
  api: ReturnType<typeof useSceneAPI>,
  nodeId: NodeId,
): ClipboardNode | null {
  const node = api.getNode(nodeId)
  if (!node) return null
  if (node.kind === 'camera') return null
  const data = stripLinks(node) as Record<string, unknown>
  delete data.name // name is restored verbatim below
  const tracks = api.getTracksForNode(nodeId).map((t) => ({
    propertyId: t.propertyId,
    defaultEasing: t.defaultEasing,
    keyframes: t.keyframes,
    ...(t.textAnimation ? { textAnimation: t.textAnimation } : {}),
  }))
  const children: ClipboardNode[] = []
  for (const child of api.getChildren(nodeId)) {
    const c = serializeSubtree(api, child.id)
    if (c) children.push(c)
  }
  return {
    data: { ...data, name: node.name },
    kind: node.kind,
    children,
    tracks,
    ...(node.kind === 'component' ? { componentId: node.id } : {}),
  }
}

function pasteClipboardItem(
  api: ReturnType<typeof useSceneAPI>,
  item: ClipboardNode,
  parentId: NodeId | null,
): NodeId | null {
  if (item.componentId) {
    return instantiateComponent(api, item.componentId, parentId)
  }
  return pasteSubtree(api, item, parentId)
}

/**
 * Recreate a clipboard subtree under `parentId`. Walks depth-first,
 * creates each node via api.createNode (which mints fresh ids), then
 * re-attaches the saved tracks against the new node ids.
 *
 * Returns the new id of the subtree root so the caller can extend the
 * selection across multiple pasted items.
 */
function pasteSubtree(
  api: ReturnType<typeof useSceneAPI>,
  item: ClipboardNode,
  parentId: NodeId | null,
): NodeId | null {
  if (item.kind === 'camera') return null
  const newId = api.createNode(
    item.kind,
    parentId,
    item.data as Partial<SceneNode>,
  )
  for (const track of item.tracks) {
    api.setTrack({
      id: genTrackId(),
      nodeId: newId,
      propertyId: track.propertyId as never,
      defaultEasing: track.defaultEasing as never,
      keyframes: track.keyframes.map((k) => ({
        ...(k as { id: string; time: number; value: unknown }),
        id: genTrackId(),
      })) as never,
      ...(track.textAnimation ? { textAnimation: track.textAnimation as never } : {}),
    })
  }
  for (const child of item.children) {
    pasteSubtree(api, child, newId)
  }
  return newId
}

function copySelectedTextAnimations(
  api: ReturnType<typeof useSceneAPI>,
): boolean {
  const tracks = collectSelectedTextAnimationTracks(api)
  if (tracks.length === 0) return false

  textAnimationClipboard = tracks.map((track) => {
    const start = Math.min(...track.keyframes.map((keyframe) => keyframe.time))
    return {
      sourceTrackId: track.id,
      nodeId: track.nodeId,
      start,
      defaultEasing: track.defaultEasing,
      textAnimation: cloneTextAnimation(track.textAnimation!),
      keyframes: track.keyframes.map((keyframe) => ({
        time: keyframe.time,
        value: keyframe.value,
        ...(keyframe.easingOut ? { easingOut: keyframe.easingOut } : {}),
        ...(keyframe.easingPreset
          ? { easingPreset: keyframe.easingPreset }
          : {}),
        ...(keyframe.presetOrigin
          ? { presetOrigin: keyframe.presetOrigin }
          : {}),
      })),
    }
  })
  keyframeClipboard = []
  clipboard = []
  return textAnimationClipboard.length > 0
}

function cutSelectedTextAnimations(api: ReturnType<typeof useSceneAPI>): boolean {
  if (!copySelectedTextAnimations(api)) return false
  const sourceTrackIds = textAnimationClipboard.map((item) => item.sourceTrackId)
  api.doc.transact(() => {
    for (const trackId of sourceTrackIds) removeTrack(api, trackId)
  })
  useUI.getState().setSelectedKeyframes([])
  useUI.getState().setSelectedTrackIds([])
  useUI.getState().setSelectedTrackId(null)
  return true
}

function pasteTextAnimationsAtPlayhead(
  api: ReturnType<typeof useSceneAPI>,
): boolean {
  if (textAnimationClipboard.length === 0) return false

  const selection = useUI.getState().selection
  const targets = selection.filter((nodeId) => api.getNode(nodeId)?.kind === 'text')
  if (targets.length === 0) return false

  const earliest = Math.min(...textAnimationClipboard.map((item) => item.start))
  const playhead = useUI.getState().playhead
  const pastedKeys: string[] = []
  const pastedTrackIds: string[] = []

  api.doc.transact(() => {
    for (const targetNodeId of targets) {
      for (const item of textAnimationClipboard) {
        const nextStart = Math.max(0, playhead + item.start - earliest)
        const shift = nextStart - item.start
        const config: TextAnimationConfig = {
          ...cloneTextAnimation(item.textAnimation),
          startTime: Math.max(0, item.textAnimation.startTime + shift),
        }
        const trackId =
          findTextAnimationTrackAtStart(api, targetNodeId, nextStart) ??
          genTrackId()
        const keyframes = item.keyframes
          .map((keyframe) => ({
            id: genTrackId(),
            time: Math.max(0, keyframe.time + shift),
            value: keyframe.value,
            ...(keyframe.easingOut
              ? { easingOut: keyframe.easingOut }
              : {}),
            ...(keyframe.easingPreset
              ? { easingPreset: keyframe.easingPreset }
              : {}),
            ...(keyframe.presetOrigin
              ? { presetOrigin: keyframe.presetOrigin }
              : {}),
          }))
          .sort((a, b) => a.time - b.time)

        api.setNodeProperty(targetNodeId, 'textAnimation', config)
        api.setTrack({
          id: trackId,
          nodeId: targetNodeId,
          propertyId: 'text.progress',
          defaultEasing: item.defaultEasing,
          textAnimation: config,
          keyframes,
        })
        pastedTrackIds.push(trackId)
        for (const keyframe of keyframes) {
          pastedKeys.push(`${trackId}:${keyframe.id}`)
        }
      }
    }
  })

  if (pastedKeys.length === 0) return false
  useUI.getState().setSelectedKeyframes(pastedKeys)
  useUI.getState().setSelectedTrackIds([...new Set(pastedTrackIds)])
  useUI.getState().setSelectedTrackId(null)
  return true
}

function collectSelectedTextAnimationTracks(
  api: ReturnType<typeof useSceneAPI>,
): Track[] {
  const ui = useUI.getState()
  const trackIds = new Set<string>(ui.selectedTrackIds)
  for (const key of ui.selectedKeyframes) {
    const sep = key.indexOf(':')
    if (sep > 0) trackIds.add(key.slice(0, sep))
  }

  const tracks: Track[] = []
  for (const trackId of trackIds) {
    const track = api.getTrack(trackId)
    if (
      !track ||
      track.propertyId !== 'text.progress' ||
      !track.textAnimation ||
      track.keyframes.length < 2
    ) {
      continue
    }
    tracks.push(track)
  }

  return tracks.sort((a, b) => {
    const aStart = Math.min(...a.keyframes.map((keyframe) => keyframe.time))
    const bStart = Math.min(...b.keyframes.map((keyframe) => keyframe.time))
    return aStart - bStart
  })
}

function findTextAnimationTrackAtStart(
  api: ReturnType<typeof useSceneAPI>,
  nodeId: NodeId,
  startTime: number,
): string | null {
  for (const track of api.getTracksForNode(nodeId)) {
    if (track.propertyId !== 'text.progress') continue
    if (track.keyframes.length < 2) continue
    const start = Math.min(...track.keyframes.map((keyframe) => keyframe.time))
    if (Math.abs(start - startTime) <= 0.01) return track.id
  }
  return null
}

function cloneTextAnimation(config: TextAnimationConfig): TextAnimationConfig {
  return JSON.parse(JSON.stringify(config)) as TextAnimationConfig
}

function copySelectedKeyframes(api: ReturnType<typeof useSceneAPI>): boolean {
  const keys = useUI.getState().selectedKeyframes
  if (keys.length === 0) return false

  const entries: Array<{
    nodeId: NodeId
    propertyId: PropertyId
    time: number
    value: KeyframeValue
    easingOut?: EasingKind
    easingPreset?: KeyframeEasingPreset
    presetOrigin?: 'in' | 'out'
  }> = []

  for (const key of keys) {
    const sep = key.indexOf(':')
    if (sep <= 0) continue
    const trackId = key.slice(0, sep)
    const kfId = key.slice(sep + 1)
    const track = api.getTrack(trackId)
    if (!track) continue
    const node = api.getNode(track.nodeId)
    if (!node) continue
    const kf = track.keyframes.find((candidate) => candidate.id === kfId)
    if (!kf) continue
    entries.push({
      nodeId: track.nodeId,
      propertyId: track.propertyId,
      time: kf.time,
      value: kf.value,
      ...(kf.easingOut ? { easingOut: kf.easingOut } : {}),
      ...(kf.easingPreset ? { easingPreset: kf.easingPreset } : {}),
      ...(kf.presetOrigin ? { presetOrigin: kf.presetOrigin } : {}),
    })
  }

  if (entries.length === 0) return false
  const start = Math.min(...entries.map((entry) => entry.time))
  keyframeClipboard = entries
    .sort((a, b) => a.time - b.time)
    .map((entry) => ({
      nodeId: entry.nodeId,
      propertyId: entry.propertyId,
      offset: entry.time - start,
      value: entry.value,
      ...(entry.easingOut ? { easingOut: entry.easingOut } : {}),
      ...(entry.easingPreset ? { easingPreset: entry.easingPreset } : {}),
      ...(entry.presetOrigin ? { presetOrigin: entry.presetOrigin } : {}),
    }))
  textAnimationClipboard = []
  return true
}

function pasteKeyframesAtPlayhead(api: ReturnType<typeof useSceneAPI>): boolean {
  if (keyframeClipboard.length === 0) return false

  const playhead = useUI.getState().playhead
  const selection = useUI.getState().selection
  const targetMap = resolveKeyframePasteTargets(api, keyframeClipboard, selection)
  const pastedKeys: string[] = []

  api.doc.transact(() => {
    for (const item of keyframeClipboard) {
      const targetNodeId = targetMap.get(item.nodeId) ?? item.nodeId
      const node = api.getNode(targetNodeId)
      if (!node || !canPastePropertyToNode(item.propertyId, node)) continue
      const kf = addKeyframe(
        api,
        targetNodeId,
        item.propertyId,
        Math.max(0, playhead + item.offset),
        item.value,
        item.easingOut,
        item.presetOrigin,
        item.easingPreset,
        { existingEasing: 'replace' },
      )
      const track = api
        .getTracksForNode(targetNodeId)
        .find((candidate) => candidate.propertyId === item.propertyId)
      if (track) pastedKeys.push(`${track.id}:${kf.id}`)
    }
  })

  if (pastedKeys.length > 0) {
    useUI.getState().setSelectedKeyframes(pastedKeys)
    useUI.getState().setSelectedTrackId(null)
  }
  return pastedKeys.length > 0
}

function resolveKeyframePasteTargets(
  api: ReturnType<typeof useSceneAPI>,
  items: ClipboardKeyframe[],
  selection: NodeId[],
): Map<NodeId, NodeId> {
  const validTargets = selection.filter((id) => api.getNode(id))
  const sourceOrder: NodeId[] = []
  for (const item of items) {
    if (!sourceOrder.includes(item.nodeId)) sourceOrder.push(item.nodeId)
  }

  const map = new Map<NodeId, NodeId>()
  if (validTargets.length === 0) return map

  if (validTargets.length === 1) {
    for (const sourceId of sourceOrder) map.set(sourceId, validTargets[0]!)
    return map
  }

  for (let i = 0; i < sourceOrder.length; i++) {
    const targetId = validTargets[i]
    if (targetId) map.set(sourceOrder[i]!, targetId)
  }
  return map
}

function canPastePropertyToNode(propertyId: PropertyId, node: SceneNode): boolean {
  if (propertyId.startsWith('camera.')) return node.kind === 'camera'
  if (propertyId === 'text.progress') return node.kind === 'text'
  if (propertyId === 'variant') return node.kind === 'instance'
  return true
}

function stripLinks<T extends object>(n: T): Partial<T> {
  const { id: _id, parent: _p, children: _c, ...rest } = n as unknown as {
    id: unknown
    parent: unknown
    children: unknown
  }
  void _id
  void _p
  void _c
  return rest as Partial<T>
}

/**
 * Local id generator for duplicated track + keyframe ids. Mirrors the
 * private `genId` in `src/anim/tracks.ts` so duplicates look the same
 * as ids created by the timeline UI. Kept here (instead of exporting
 * from anim/tracks.ts) so this hook doesn't reach across module
 * boundaries just for a string generator.
 */
function genTrackId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}
